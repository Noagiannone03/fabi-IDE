import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkPlugins,preparePlugins} from './prepare-plugins.mjs';
async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'fabi-plugin-check-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(join(root,'package.json'),JSON.stringify({theiaPlugins:{'test.primary':'https://open-vsx.org/api/test/primary/1.2.3/file/test.primary-1.2.3.vsix'}}));
 const put=async(name,extra={})=>{const dir=join(root,'plugins','test.'+name,'extension');await mkdir(dir,{recursive:true});await writeFile(join(dir,'package.json'),JSON.stringify({publisher:'test',name,version:'1.2.3',...extra}));return dir;};
 return {root,put};
}
test('complete pinned cache and transitive dependencies never invoke the network',async t=>{
 const f=await fixture(t);await f.put('primary',{extensionDependencies:['test.second']});await f.put('second',{extensionPack:['test.third']});await f.put('third',{extensionDependencies:['test.primary']});
 const result=await preparePlugins(f.root,()=>{throw Error('Unexpected download');});assert.equal(result.count,3);assert.deepEqual(result.issues,[]);
});
test('missing dependency is downloaded and revalidated',async t=>{
 const f=await fixture(t);await f.put('primary',{extensionDependencies:['test.second']});let called=0;
 await preparePlugins(f.root,async()=>{called++;await f.put('second');});assert.equal(called,1);
});
test('wrong pinned version and missing runtime entry fail validation',async t=>{
 const f=await fixture(t);await f.put('primary',{version:'0.0.1',main:'./out/main'});
 assert.equal((await checkPlugins(f.root)).issues.length,2);
 await assert.rejects(preparePlugins(f.root,async()=>{}),/incomplètes/);
});
test('network failure cannot turn missing plugins into a successful build',async t=>{
 const f=await fixture(t);await assert.rejects(preparePlugins(f.root,async()=>{throw Error('offline');}),/offline/);
});
