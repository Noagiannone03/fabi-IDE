// electron-builder afterPack hook: build before signing, so both the nested
// native bundle and its image are sealed by normal macOS code signing.
const { mkdir, copyFile, writeFile } = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const { join, resolve } = require('node:path');
const { Arch } = require('builder-util');
module.exports = async context => {
    if (context.electronPlatformName !== 'darwin') return;
    const root = resolve(__dirname, '..');
    const contents = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'PlugIns', 'FabiDockTile.docktileplugin', 'Contents');
    await mkdir(join(contents, 'MacOS'), { recursive: true });
    await mkdir(join(contents, 'Resources'), { recursive: true });
    const arch = Arch[context.arch];
    const arches = arch === 'universal' ? ['arm64', 'x86_64'] : arch === 'arm64' ? ['arm64'] : arch === 'x64' ? ['x86_64'] : [];
    if (!arches.length) throw new Error(`Unsupported Dock plug-in architecture: ${arch}`);
    execFileSync('xcrun', ['clang', '-bundle', '-fobjc-arc', '-Os', '-Wall', '-Wextra', '-Werror',
        '-mmacosx-version-min=12.0', ...arches.flatMap(value => ['-arch', value]),
        '-framework', 'AppKit', join(root, 'electron-app/resources/dock-tile/FabiDockTile.m'),
        '-o', join(contents, 'MacOS', 'FabiDockTile')], { stdio: 'inherit' });
    await copyFile(join(root, 'branding/png/fox-512.png'), join(contents, 'Resources', 'fox.png'));
    await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>fr.undefinedstudio.fabi.docktile</string>
<key>CFBundleExecutable</key><string>FabiDockTile</string>
<key>CFBundlePackageType</key><string>BNDL</string>
<key>CFBundleVersion</key><string>1</string>
<key>NSPrincipalClass</key><string>FabiDockTile</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
</dict></plist>\n`);
    // electron-builder deliberately skips Contents/PlugIns. Seal this bundle
    // here with the same selected identity/keychain before it seals the host.
    const config = context.packager.platformSpecificBuildOptions;
    const { keychainFile } = await context.packager.codeSigningInfo.value;
    const identity = await context.packager.helper.findSigningIdentity(
        false, config.type === 'development', config.identity, keychainFile, config);
    if (!identity) throw new Error('A signing identity is required for the Fabi Dock plug-in. Use package:mac for a local ad-hoc build.');
    const args = ['--force', '--sign', identity.hash || identity.name, '--options', 'runtime'];
    if (keychainFile) args.push('--keychain', keychainFile);
    if (identity.name !== '-') args.push('--timestamp');
    execFileSync('codesign', [...args, resolve(contents, '..')], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--strict', resolve(contents, '..')], { stdio: 'inherit' });
};
