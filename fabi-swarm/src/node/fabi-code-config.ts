import { createHash } from 'crypto';
import { FABI_CODE_PROVIDER_ID } from '../common/fabi-code-protocol';

export const FABI_CODE_DEFAULT_CONTEXT_TOKENS = 32_768;
export const FABI_CODE_DEFAULT_OUTPUT_TOKENS = 4_096;

export interface FabiCodeConfigInput {
    baseURL: string;
    model: string;
    apiKey?: string;
    maxContextTokens?: number;
    maxOutputTokens?: number;
}

export interface FabiCodeConfigResult {
    config: Record<string, unknown>;
    /** Signature non secrète utilisée pour décider si le sidecar doit redémarrer. */
    key: string;
    contextTokens: number;
    outputTokens: number;
}

export function positiveTokenLimit(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Construit le provider OpenCode à partir du contrat de capacité annoncé par le
 * scheduler. On ne revendique jamais une fenêtre fictive supérieure au modèle.
 */
export function buildFabiCodeConfig(input: FabiCodeConfigInput): FabiCodeConfigResult {
    const contextTokens = positiveTokenLimit(input.maxContextTokens, FABI_CODE_DEFAULT_CONTEXT_TOKENS);
    const requestedOutput = positiveTokenLimit(input.maxOutputTokens, FABI_CODE_DEFAULT_OUTPUT_TOKENS);
    const outputTokens = Math.min(requestedOutput, contextTokens);
    const options: Record<string, unknown> = { baseURL: input.baseURL.replace(/\/+$/, '') };
    if (input.apiKey) {
        options.apiKey = input.apiKey;
    }
    const credential = createHash('sha256').update(input.apiKey ?? '').digest('hex');
    const key = JSON.stringify({
        baseURL: options.baseURL,
        model: input.model,
        contextTokens,
        outputTokens,
        credential
    });
    return {
        key,
        contextTokens,
        outputTokens,
        config: {
            $schema: 'https://opencode.ai/config.json',
            share: 'disabled',
            permission: {
                bash: 'ask',
                webfetch: 'ask'
            },
            provider: {
                [FABI_CODE_PROVIDER_ID]: {
                    npm: '@ai-sdk/openai-compatible',
                    name: 'Fabi Swarm',
                    options,
                    models: {
                        [input.model]: {
                            name: input.model,
                            tool_call: true,
                            limit: { context: contextTokens, output: outputTokens }
                        }
                    }
                }
            },
            model: `${FABI_CODE_PROVIDER_ID}/${input.model}`
        }
    };
}
