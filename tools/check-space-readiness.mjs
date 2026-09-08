import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import puppeteer from 'puppeteer';
const source=ts.createSourceFile('manager.ts',readFileSync('fabi-spaces/src/electron-main/space-manager.ts','utf8'),ts.ScriptTarget.Latest,true);
let method;
function visit(node) {
    if(ts.isMethodDeclaration(node)&&node.name.getText(source)==='fadeInView') method=node.getText(source);
    ts.forEachChild(node,visit);
}
visit(source);assert.ok(method);
let injected;
const context={capture:script=>{injected=script;return Promise.resolve();}};
vm.runInNewContext(ts.transpileModule(`class Test { views = new Map([['a',{webContents:{isDestroyed:()=>false,isLoading:()=>false,executeJavaScript:capture}}]]); ${method} } new Test().fadeInView('a');`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
const browser=await puppeteer.launch({headless:true});
try {
    const page=await browser.newPage();
    await page.setContent('<div id="theia-app-shell">Editor</div><div class="theia-preload"></div>');
    await page.evaluate(injected);
    assert.equal(await page.$eval('#theia-app-shell',e=>e.getAnimations().length),0);
    await page.$eval('.theia-preload',e=>e.classList.add('theia-hidden'));
    await page.waitForFunction(()=>window.fabiSpaceTransition?.playState==='running');
    assert.equal(await page.evaluate(()=>window.fabiSpaceTransition.effect.getTiming().duration),480);
    await page.evaluate(()=>window.fabiSpaceTransition.finish());
    await page.evaluate(injected);
    assert.equal(await page.$eval('#theia-app-shell',e=>e.getAnimations().length),1);
    await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
    await page.evaluate(injected);
    assert.equal(await page.$eval('#theia-app-shell',e=>e.getAnimations().length),0);
    console.log('Production Space transition: waits for readiness, warm switch, cancellation and reduced motion passed.');
} finally { await browser.close(); }
