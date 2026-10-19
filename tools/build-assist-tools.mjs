import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const license = await readFile(join(dirname(require.resolve('zod/package.json')), 'LICENSE'), 'utf8');
export const assistToolsBundle = join(root, 'fabi-swarm/lib/assist-tools.mjs');
await build({
    entryPoints: [join(root, 'fabi-swarm/src/node/assist/assist-runtime-tools.ts')],
    outfile: assistToolsBundle, bundle: true, platform: 'node', format: 'esm',
    banner: { js: `/* Bundled dependency: Zod\n${license.replaceAll('*/', '* /')}*/` },
    target: 'node22', minify: false, sourcemap: false,
});
