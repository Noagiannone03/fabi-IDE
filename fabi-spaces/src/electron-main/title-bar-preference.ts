import { promises as fs } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { applyEdits, modify, parse, ParseError } from 'jsonc-parser';

const TITLE_BAR_PREFERENCE = 'window.titleBarStyle';
const SPACES_TITLE_BAR_STYLE = 'custom';

export type TitleBarPreferenceMigration = 'created' | 'updated' | 'unchanged' | 'invalid';

export function resolveUserSettingsPath(environment: NodeJS.ProcessEnv = process.env): string {
    const configured = environment.THEIA_CONFIG_DIR?.trim();
    const configDirectory = configured ? resolve(configured) : join(homedir(), '.theia');
    return join(configDirectory, 'settings.json');
}

/**
 * Spaces rend les frontends Theia dans des WebContentsView : ils n'ont donc pas de
 * cadre natif propre. Theia synchronise sinon `native` vers `custom` après le
 * chargement du frontend et affiche à tort une demande de redémarrage.
 *
 * La préférence est alignée avant la création de la première vue. L'édition JSONC
 * préserve les commentaires et toutes les autres préférences de l'utilisateur.
 */
export async function ensureSpacesTitleBarPreference(settingsPath = resolveUserSettingsPath()): Promise<TitleBarPreferenceMigration> {
    let content: string;
    try {
        content = await fs.readFile(settingsPath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
        await fs.mkdir(dirname(settingsPath), { recursive: true });
        await writeSettings(settingsPath, `{\n  "${TITLE_BAR_PREFERENCE}": "${SPACES_TITLE_BAR_STYLE}"\n}\n`);
        return 'created';
    }

    const errors: ParseError[] = [];
    const current = parse(content, errors, { allowTrailingComma: true, disallowComments: false }) as Record<string, unknown> | undefined;
    if (errors.length || !current || typeof current !== 'object' || Array.isArray(current)) {
        return 'invalid';
    }
    if (current[TITLE_BAR_PREFERENCE] === SPACES_TITLE_BAR_STYLE) {
        return 'unchanged';
    }

    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const edits = modify(content, [TITLE_BAR_PREFERENCE], SPACES_TITLE_BAR_STYLE, {
        formattingOptions: { insertSpaces: true, tabSize: 2, eol }
    });
    await writeSettings(settingsPath, applyEdits(content, edits));
    return 'updated';
}

async function writeSettings(settingsPath: string, content: string): Promise<void> {
    // Aucun frontend n'est encore créé à ce stade : une écriture directe évite les
    // différences de remplacement par rename entre macOS et Windows.
    await fs.writeFile(settingsPath, content, { encoding: 'utf8', mode: 0o600 });
}
