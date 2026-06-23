import puppeteer from 'puppeteer';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: 'new', executablePath: CHROME, defaultViewport: { width: 1512, height: 945 }, args: ['--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:3000/#/Users/noagiannone/Documents/fabi-ide', { waitUntil: 'networkidle2', timeout: 90000 }).catch(()=>{});
await p.waitForSelector('#theia-app-shell', { timeout: 90000 }).catch(()=>{});
await sleep(4000);
await p.keyboard.down('Meta'); await p.keyboard.down('Shift'); await p.keyboard.press('KeyP'); await p.keyboard.up('Shift'); await p.keyboard.up('Meta');
await sleep(1000);
const info = await p.evaluate(() => {
  const dump = sel => Array.from(document.querySelectorAll(sel)).map(el => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return { sel, cls: el.className?.toString().slice(0,80), parent: el.parentElement?.className?.toString().slice(0,50),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      pos: cs.position, left: cs.left, top: cs.top, width: cs.width, transform: cs.transform };
  });
  return { qiw: dump('.quick-input-widget'), mqiw: dump('.monaco-quick-input-widget'), win: { w: innerWidth, h: innerHeight } };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
