// Isolated rendering of the production React component and CSS; no user IDE state is changed.
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const bundle = await build({ stdin: { contents: `
import React from '@theia/core/shared/react';
import { createRoot } from 'react-dom/client';
import { ReplyContent } from './fabi-swarm/src/browser/assist/assist-reply';
const renderer = { render({value}) { const element=document.createElement('div'); for (const text of value.split(/\\n\\n/)) { const p=document.createElement('p'); p.textContent=text; element.append(p); } return {element,dispose(){}}; } };
const model = { openSource(path,line) { window.openedSource={path,line}; }, busy:false };
const root=createRoot(document.getElementById('root'));
window.showReply=reply=>root.render(<ReplyContent reply={reply} model={model} markdown={renderer}/>);
`, loader:'tsx', resolveDir:process.cwd() }, bundle:true, write:false, platform:'browser', plugins:[{name:'fixture-code-renderer', setup(b) { b.onResolve({filter:/^\.\/assist-code-block$/},()=>({path:'code',namespace:'fixture'})); b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export function renderAssistCodeBlock(){ return document.createElement("pre"); }'})); }}] });
const browser=await puppeteer.launch({headless:true});
try {
 const page=await browser.newPage();
 await page.setViewport({width:720,height:900});
 await page.setContent('<html lang="fr"><body style="margin:0;background:#17191f;color:#dddfe7;font-family:system-ui"><main id="root" class="fabi-assist" style="max-width:560px;margin:auto;padding:28px"></main></body></html>');
 await page.addStyleTag({content:await readFile('fabi-swarm/src/browser/style/fabi-assist.css','utf8')});
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 const reply={title:'Une disparition au bon moment',takeaway:'Le point reste visible pendant le versement. Il disparaît seulement quand le signal de fin arrive.',explanation:'Un callback est une fonction appelée à un moment précis.\\n\\nIci, on attend le signal de fin plutôt qu’un délai choisi au hasard.',sources:[{path:'reward.ts',line:12}],terms:[{term:'signal',definition:'Un message qui indique qu’une action est terminée.'}],diagram:{caption:'Du versement à la disparition',steps:[{title:'Verser le carburant',detail:'L’animation montre le carburant reçu. Le point reste encore sur la carte.'},{title:'Recevoir le signal',detail:'Le signal appelle la fonction qui prépare la disparition.',value:'onRewardSettled()',source:{path:'reward.ts',line:12}},{title:'Retirer le point',detail:'Le point se comprime, puis disparaît dans un petit nuage.'}]}};
 await page.evaluate(r=>window.showReply(r),reply);
 await page.waitForSelector('.fabi-path-detail');
 assert.equal(await page.$$eval('.fabi-explanation-path li',els=>els.length),3);
 assert.equal(await page.$eval('.fabi-reply-depth',el=>el.open),false);
 await page.click('.fabi-explanation-path li:nth-child(2) button');
 assert.match(await page.$eval('.fabi-path-detail',el=>el.textContent),/onRewardSettled/);
 await page.click('.fabi-path-source');
 assert.deepEqual(await page.evaluate(()=>window.openedSource),{path:'reward.ts',line:12});
 await page.focus('.fabi-explanation-path li:nth-child(3) button');
 await page.keyboard.press('Enter');
 assert.match(await page.$eval('.fabi-path-detail h4',el=>el.textContent),/Retirer/);
 await page.click('.fabi-reply-depth summary');
 assert.equal(await page.$$eval('.fabi-reply-depth p',els=>els.length),2);
 await page.click('.fabi-explanation-path li:nth-child(2) button');
 await page.screenshot({path:'/tmp/fabi-explanation-wide.png'});
 await page.setViewport({width:360,height:900});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'/tmp/fabi-explanation-narrow.png'});
 // A new two-step answer must not render an out-of-bounds step from the previous answer.
 await page.click('.fabi-explanation-path li:nth-child(3) button');
 await page.evaluate(r=>window.showReply({...r,diagram:{...r.diagram,steps:r.diagram.steps.slice(0,2)}}),reply);
 await page.waitForFunction(()=>document.querySelectorAll('.fabi-explanation-path li').length===2);
 await page.evaluate(()=>window.showReply({title:'Ancienne réponse',explanation:'Un paragraphe.\\n\\nUne autre idée.',sources:[]}));
 await page.waitForFunction(()=>!document.querySelector('.fabi-explanation-path'));
 assert.equal(await page.$$eval('.fabi-assist-markdown p',els=>els.length),2);
 console.log('PASS: steps, keyboard, source navigation, progressive detail, escaped paragraphs, legacy reply and 360px layout. Screenshots: /tmp/fabi-explanation-{wide,narrow}.png');
} finally { await browser.close(); }
