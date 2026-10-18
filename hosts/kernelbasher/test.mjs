// Integration tests against the real WebGPU pipeline. Requires Playwright + Edge.
// PLAYWRIGHT_MODULE may point at an existing installation; no download occurs.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=resolve(root,'out/kernelbasher');
const server=createServer(async(req,res)=>{
    try{
        const path=resolve(base,'.'+new URL(req.url,'http://localhost').pathname);
        if(!path.startsWith(base))throw Error('outside assets');
        const body=await readFile(path.endsWith(base)?resolve(path,'index.html'):path);
        res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.wasm':'application/wasm'})[extname(path)]||'application/octet-stream');res.end(body);
    }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/index.html?test=1`;
let browser;
const results=[];
await mkdir(resolve(root,'out/kernelbasher-test'),{recursive:true});
try{
    browser=await chromium.launch({channel:'msedge',headless:true});
    const page=await browser.newPage({viewport:{width:384,height:370}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.waitForFunction(()=>window.previewTest||document.body.classList.contains('error'),null,{timeout:30000});
    assert.ok(await page.evaluate(()=>!!window.previewTest),await page.locator('#status').innerText());
    const defaults=await page.evaluate(()=>window.previewTest.state().settings);
    const set=async(s,t=2000)=>page.evaluate(({s,t})=>{previewTest.settings(s);previewTest.seek(t);},{s,t});
    const shot=()=>page.evaluate(async()=>{
        const pixels=await previewTest.stage.gpu.read();
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))).map(x=>x.toString(16).padStart(2,'0')).join('');
        const sums=[0,0,0];for(let i=0;i<pixels.length;i+=4)for(let c=0;c<3;c++)sums[c]+=pixels[i+c];
        return {hash,mean:sums.map(x=>x/(pixels.length/4))};
    });
    async function check(name,s,t=2000){
        await set(defaults,t);const before=await shot();await set(s,t);const after=await shot();
        assert.notEqual(before.hash,after.hash,name+' must change pixels');
        assert.deepEqual(await page.evaluate(()=>previewTest.state().errors),[],name+' WebGPU errors');
        results.push({name,before,after});console.log(name+': passed');
    }
    await set(defaults);const baseline=await shot();assert.ok(baseline.mean.some(x=>x>1),'visible animation');
    await page.screenshot({path:resolve(root,'out/kernelbasher-test/preview-default.png')});
    for(const [name,start,t] of [['fog',0,4500],['initial glow',3,200],['main glow',6,2000],['scene',9,2000],['end glow',12,4900],['flubber',15,2000]]){
        const s=structuredClone(defaults);s.colours.splice(start,3,255,0,20);await check(name,s,t);
    }
    for(const [key,value,t] of [['radius',1,2000],['radius',0,2000],['radius',6.375,2000],['wire',1,2000],['camera',7,2000],['camera',8,2000],['whiteAnimation',1,2000],['whiteSplash',1,7000],['torn',1,6500]])await check(key+'='+value,{...defaults,[key]:value},t);
    const alpha=structuredClone(defaults);alpha.colours[18]=0;await check('alpha=0',alpha);
    const white={...defaults,whiteAnimation:1};await set(white);const without=await shot();await set({...white,keepMachinery:1});assert.notEqual((await shot()).hash,without.hash);results.push({name:'keep machinery on white'});
    await check('custom logo',{...defaults,logo:{vertices:[-15,0,0,15,0,0,0,15,0],indices:[0,1,2]}},7000);
    await page.screenshot({path:resolve(root,'out/kernelbasher-test/preview-custom-logo.png')});
    // Original 1..6 quirk, restoration and repeated seek must be deterministic.
    await set(defaults);assert.equal((await shot()).hash,baseline.hash);
    for(let camera=2;camera<=6;camera++){await set({...defaults,camera});assert.equal((await shot()).hash,baseline.hash);}
    await set(defaults,7000);const stable=await shot();const mem=await page.evaluate(()=>previewTest.state());
    for(let i=0;i<12;i++){await set({...defaults,torn:i%2},7000);}
    await set(defaults,7000);assert.equal((await shot()).hash,stable.hash);
    const after=await page.evaluate(()=>previewTest.state());assert.equal(after.top,mem.top);assert.equal(after.memory,mem.memory);
    results.push({name:'restoration, camera quirk, repeated replay, stable WASM memory',memory:after.memory,top:after.top});
    // Real wall-clock playback crosses two automatic loop boundaries.
    await page.evaluate(()=>{previewTest.restart();previewTest.play();});
    await page.waitForFunction(()=>previewTest.state().cycles>=2,{timeout:30000});
    assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>previewTest.state().errors),[]);
    results.push({name:'two automatic loops',state:await page.evaluate(()=>previewTest.state())});
    await writeFile(resolve(root,'out/kernelbasher-test/preview-tests.json'),JSON.stringify({passed:true,checks:results.length,results},null,2)+'\n');
    console.log(JSON.stringify({passed:true,checks:results.length}));
}finally{await browser?.close();server.close();}
