/**
 * This file can be edited to adjust the ESBuild build process.
 * To reset, delete this file and rerun theia build again.
 */
import { browserOptions, watch, minify, sourcemap } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';
import { electronOptions } from './gen-esbuild.electron.mjs';
import esbuild from 'esbuild';

// Diagram types/layout engines are independent ESM chunks, not part of the IDE
// startup bundle. Native module scripts load them on the first diagram only.
const diagramContext = await esbuild.context({
    entryPoints: { index: '../fabi-swarm/src/browser/assist/assist-diagram-runtime.ts' },
    outdir: 'lib/frontend/assist-diagrams', chunkNames: '[name]-[hash]',
    bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022',
    minify, sourcemap
});
// Preserve DI class names for diagnostics while still minifying code.
browserOptions.keepNames = true;
const browserContext = await esbuild.context(browserOptions);
nodeOptions.external = [...(nodeOptions.external || []), 'opencode-ai', 'opencode-ai/*'];
const nodeContext = await esbuild.context(nodeOptions);
const electronContext = await esbuild.context(electronOptions);

if (watch) {
    await Promise.all([
        diagramContext.watch(),
        browserContext.watch(),
        nodeContext.watch(),
        electronContext.watch(),
    ]);
} else {
    try {
        await diagramContext.rebuild();
        await diagramContext.dispose();
        await browserContext.rebuild();
        await browserContext.dispose();
        await nodeContext.rebuild();
        await nodeContext.dispose();
        await electronContext.rebuild();
        await electronContext.dispose();
    } catch {
        process.exit(1);
    }
}
