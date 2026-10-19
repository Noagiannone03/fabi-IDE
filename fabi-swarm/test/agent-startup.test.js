const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
class FabiTerminalWidget {}
const source = ts.createSourceFile('terminals.ts', fs.readFileSync(path.join(__dirname, '../src/browser/agents/fabi-agent-terminals.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'FabiAgentTerminals');
function method(name) {
 const node = declaration.members.find(n => n.name?.getText(source) === name);
 return vm.runInNewContext(ts.transpileModule(`${node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : ''}function ${name}(${node.parameters.map(p => p.getText(source)).join(',')}) ${node.body.getText(source)}; ${name}`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText, {STORAGE_KEY:'fabi.agentTerminals', FabiTerminalWidget, setTimeout, clearTimeout});
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
 let ready;const gate=new Promise(r=>ready=r);const restored=[];const errors=[];
 const binding={cli:'codex',cwd:'file:///project',sessionId:'exact-session'};
 const instance={stopped:false,bindings:new Map(),storage:{getData:async()=>({terminal:binding})},changedEmitter:{fire(){}},state:{reachedState:s=>{assert.equal(s,'ready');return gate;}},restore:async(id,b)=>{restored.push({id,b});await new Promise(()=>{});},messages:{error:e=>errors.push(e)},restoreSavedSessions:method('restoreSavedSessions')};
 return {instance,ready,restored,errors,binding};
}
test('workbench startup does not await CLI readiness; exact sessions restore only after ready',async()=>{
 const f=fixture();assert.equal(method('onDidInitializeLayout').call(f.instance),undefined);await tick();
 assert.equal(f.instance.bindings.get('terminal'),f.binding);assert.equal(f.restored.length,0);
 f.ready();await tick();assert.equal(f.restored.length,1);assert.equal(f.restored[0].b.sessionId,'exact-session');
});
test('a closing frontend cannot start deferred agents',async()=>{
 const f=fixture();method('onDidInitializeLayout').call(f.instance);await tick();method('onStop').call(f.instance);f.ready();await tick();assert.equal(f.restored.length,0);
});
test('storage failure is reported without rejecting workbench startup',async()=>{
 const f=fixture();f.instance.storage.getData=async()=>{throw Error('storage unavailable');};
 assert.equal(method('onDidInitializeLayout').call(f.instance),undefined);await tick();assert.equal(f.errors.length,1);assert.equal(f.restored.length,0);
});

test('hidden terminals settle on delivered output without waiting for xterm parsing',async()=>{
 const terminal=new FabiTerminalWidget();let receive;let disposed=false;
 terminal.onDidReceiveOutput=listener=>{receive=listener;return {dispose(){disposed=true;}};};
 terminal.onOutput=()=>{throw Error('Hidden xterm rendering must not gate restoration');};
 const settled=method('whenOutputSettles').call({},terminal,1,10000);
 receive('shell prompt');await settled;assert.equal(disposed,true);
});
test('ordinary Theia terminals retain their output-event fallback',async()=>{
 let receive;const terminal={onOutput:listener=>{receive=listener;return {dispose(){}};}};
 const settled=method('whenOutputSettles').call({},terminal,1,10000);receive('prompt');await settled;
});
