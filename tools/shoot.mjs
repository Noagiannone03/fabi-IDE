/*
 * Fabi — capture d'écran headless de l'IDE (browser-app).
 *
 * Prérequis : le serveur browser-app tourne (`yarn start:browser`) sur :3000.
 * Usage : node tools/shoot.mjs [url] [outDir]
 *
 * Capture le shell, puis ouvre la palette de commandes et la capture aussi.
 * Sert à VÉRIFIER le rendu (cf. DESIGN.md : « on ne devine pas, on mesure »).
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.argv[2] || 'http://localhost:3000/#/Users/noagiannone/Documents/fabi-ide';
const OUT = process.argv[3] || 'tools/shots';
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const CHROME = process.env.CHROME_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME,
    defaultViewport: { width: 1512, height: 945, deviceScaleFactor: 2 },
    args: ['--no-sandbox', '--force-color-profile=srgb']
});
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('  [page error]', m.text().slice(0, 200)); });

console.log('→ load', URL);
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 }).catch(e => console.log('goto:', e.message));
await page.waitForSelector('#theia-app-shell', { timeout: 90000 }).catch(() => console.log('no shell selector'));
await sleep(6000); // laisse Monaco + thème + îlots se poser

await page.screenshot({ path: join(OUT, '01-shell.png') });
console.log('✓ 01-shell.png');

// Page d'accueil : si un widget welcome est présent, capture ciblée
const welcome = await page.$('.fabi-welcome');
if (welcome) { await welcome.screenshot({ path: join(OUT, '02-welcome.png') }); console.log('✓ 02-welcome.png'); }

// Explorateur : sélectionne un fichier puis capture le panneau gauche (cropé)
try {
    const nodes = await page.$$('.theia-TreeNode');
    if (nodes[3]) { await nodes[3].click(); await sleep(400); }
    await page.screenshot({ path: join(OUT, '04-explorer.png'), clip: { x: 0, y: 0, width: 320, height: 945 } });
    console.log('✓ 04-explorer.png');
} catch (e) { console.log('explorer shot skipped:', e.message); }

// Palette de commandes (Cmd+Shift+P)
await page.keyboard.down('Meta'); await page.keyboard.down('Shift');
await page.keyboard.press('KeyP');
await page.keyboard.up('Shift'); await page.keyboard.up('Meta');
await sleep(1200);
await page.screenshot({ path: join(OUT, '03-palette.png') });
console.log('✓ 03-palette.png');

await browser.close();
console.log('done →', OUT);
