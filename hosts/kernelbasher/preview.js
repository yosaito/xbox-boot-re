import {Core, Run} from './upstream/core.js';
import {Gpu} from './upstream/gpu.js';
import {Renderer} from './upstream/renderer.js';
import {defaults,validate,cameraPath,logoVertices} from './settings.js';

// NV2A draw constants from upstream xboot.h. Keep the adapter separate from
// the pinned upstream renderer so provenance and upstream updates stay clear.
const SCREEN=27, LOGO_TARGET=18, SLOT=128, K=80, TINT=104;
const colour=(s,start)=>s.colours.slice(start,start+3).map(n=>n/255);
const factor=(rgb,a)=>((Math.round(a*255)<<24)|(Math.round(rgb[0]*255)<<16)|(Math.round(rgb[1]*255)<<8)|Math.round(rgb[2]*255))>>>0;
class PreviewRenderer extends Renderer {
    constructor(gpu,core,torn) {
        super(gpu,core);this.settings=defaults;
        this.stockLogo=this.meshes.get('15/0');this.custom=null;
        this.stockX=[0,1,2,3].map(i=>this.meshes.get(`${9+i}/0`));
        this.tornX=torn.map(m=>this.uploadMesh(m));
    }
    uploadMesh(m){
        const vertices=Float32Array.from(m.vertices), indices=Uint16Array.from(m.indices);
        const buffer=this.device.createBuffer({size:Math.max(vertices.byteLength,4),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
        this.device.queue.writeBuffer(buffer,0,vertices);return {...m,vertices,indices,buffer};
    }
    configure(s){
        if(JSON.stringify(s.logo)!==JSON.stringify(this.settings.logo)){
            this.custom?.buffer.destroy();this.custom=null;
            if(s.logo)this.custom=this.uploadMesh({floats:3,vertices:logoVertices(s.logo.vertices),indices:s.logo.indices});
        }
        this.meshes.set('15/0',this.custom||this.stockLogo);
        (s.torn?this.tornX:this.stockX).forEach((m,i)=>this.meshes.set(`${9+i}/0`,m));
        this.lists.clear();this.settings=s;
    }
    isWire(d){return this.settings.wire&&d.color===SCREEN&&d.what===1;}
    list(d,m,indices,edges=false){return super.list(d,m,indices,edges||this.isWire(d));}
    prepare(d,p,slot,w,h){
        const s=this.settings,alpha=s.colours[18]/255;
        if(d.what===1&&s.whiteAnimation&&!s.keepMachinery)return null;
        if([2,3,4].includes(d.what)&&s.radius===0)return null;
        if(d.what===11&&this.custom)d.count=this.custom.indices.length;
        const saved=p.slice(d.psFirst,d.psFirst+4*d.psCount);
        // Replace colour factors, keeping the original timing/brightness curves.
        if(d.what===1&&d.psCount){
            const rgb=colour(s,9),base=[Math.fround(.2079),1,Math.fround(.1)];
            for(let j=0;j<d.psCount;j++)for(let c=0;c<3;c++)p[d.psFirst+4*j+c]*=rgb[c]/base[c];
        }
        if([3,4].includes(d.what)){
            const rgb=colour(s,15),base=[.25,1,Math.fround(.15)];
            for(let j=0;j<Math.min(d.psCount,2);j++)for(let c=0;c<3;c++)p[d.psFirst+4*j+c]*=rgb[c]/base[c];
            p[d.psFirst+3]*=alpha;
        }
        if(d.what===2)d.factor=factor(colour(s,6),(d.factor>>>24)/255*alpha);
        if(d.what===15)d.factor=factor(colour(s,this.core.timing().t<.6?3:12),(d.factor>>>24)/255);
        if(d.what===14&&d.psCount>=2){
            const fog=colour(s,0),end=colour(s,12),g=p[d.psFirst+1],f=p[d.psFirst+5];
            for(let c=0;c<3;c++){p[d.psFirst+c]=g*fog[c];p[d.psFirst+4+c]=f*end[c];}
        }
        // White splash alters the clear/border colours used for the logo image.
        const it=super.prepare(d,p,slot,w,h);p.set(saved,d.psFirst);if(!it)return null;
        const u=this.uniformData.subarray(slot*SLOT,(slot+1)*SLOT);
        if(s.whiteSplash&&['fixed','plain'].includes(it.kind))u.set([1,1,1,1],K+8);
        if(this.isWire(d)){
            u.set([...colour(s,9),1,1,0,0,0],TINT);
            it.pipeline=this.pipeline(it.kind,it.mesh,d,'wire');
        }
        return it;
    }
    pass(enc,group){
        const s=this.settings||defaults;
        if(group.clearColour&&((group.color===SCREEN&&(this.core.timing().t<6?s.whiteAnimation:s.whiteSplash))||(group.color===LOGO_TARGET&&s.whiteSplash)))
            group={...group,clearColour:[1,1,1]};
        super.pass(enc,group);
    }
}

let stopped=false,paused=false,pending=null,stage=null,last=0,elapsed=0,cycles=0,applied=0;
const $=id=>document.getElementById(id);
function fail(error){stopped=true;document.body.classList.add('error');$('status').textContent=`Preview unavailable: ${error.message}. WebView2 and a WebGPU-capable graphics driver are required. BIOS editing is still available.`;}
window.addEventListener('error',e=>fail(e.error||new Error(e.message)));
window.addEventListener('unhandledrejection',e=>fail(e.reason||new Error('Animation failed')));
const receive=s=>{const valid=validate(s);if(valid)pending=valid;};
window.chrome?.webview?.addEventListener('message',e=>receive(e.data));

function apply(s){
    const {run,renderer,core}=stage,old=renderer.settings;
    const replay=s.radius!==old.radius||s.camera!==old.camera||s.random!==old.random||s.torn!==old.torn||s.whiteSplash!==old.whiteSplash||JSON.stringify(s.logo)!==JSON.stringify(old.logo);
    renderer.configure(s);core.x.kb_set_radius(s.radius);
    if(s.camera!==old.camera||s.random!==old.random)run.path=cameraPath(s);
    if(replay){const ticks=run.ticks.slice();run.replay(ticks);}
    applied++;render();
}
function render(){const {renderer,gpu,core}=stage;renderer.draw();gpu.present();if(gpu.errors.length)throw new Error(gpu.errors[0]);$('time').textContent=`${Math.min(core.timing().t,8).toFixed(1)}s / 8.0s`;}
function restart(){const {run,renderer}=stage;run.path=cameraPath(renderer.settings);run.restart();elapsed=0;last=0;render();}
function frame(now){
    if(stopped)return;
    try{
        if(pending){const s=pending;pending=null;apply(s);}
        const dt=last?Math.min(now-last,100):0;last=now;
        if(!paused&&!document.hidden){
            elapsed+=dt;
            if(elapsed>=9000){cycles++;restart();}
            else {const {run}=stage;const tick=Math.min(8001,Math.floor(elapsed));if(tick>run.tick)run.advance(tick);render();}
        }
    }catch(e){fail(e);return;}
    requestAnimationFrame(frame);
}
async function start(){
    const get=async name=>{const r=await fetch(name);if(!r.ok)throw new Error(`Missing bundled file ${name}`);return r;};
    const [wasm,pack,layout,torn]=await Promise.all([get('xboot.wasm').then(r=>r.arrayBuffer()),get('xboot.pak').then(r=>r.arrayBuffer()),get('layout.json').then(r=>r.json()),get('torn.json').then(r=>r.json())]);
    const core=await Core.load(wasm,pack,layout);core.x.kb_set_radius(defaults.radius);
    const gpu=await Gpu.create($('screen')),run=new Run(core),renderer=new PreviewRenderer(gpu,core,torn);
    gpu.resize(384,288);renderer.resize(384,288);
    stage={core,gpu,run,renderer};run.path=0;
    run.onRestart=()=>renderer.clearLogo();
    run.onAdvance=()=>{if(core.logoDrawnToTexture())renderer.draw('logo');};
    gpu.device.lost.then(info=>{if(!stopped)fail(new Error(`Graphics device lost (${info.reason}); reopen KernelBasher to retry`));});
    $('pause').onclick=()=>{paused=!paused;$('pause').textContent=paused?'Play':'Pause';last=0;};
    $('restart').onclick=()=>{restart();};
    document.addEventListener('visibilitychange',()=>{last=0;});
    // The pane has useful keyboard controls without trapping Escape in Chromium.
    document.addEventListener('keydown',e=>{if(e.key==='Escape')window.chrome?.webview?.postMessage('escape');});
    $('status').textContent='Live reference preview · loops silently';
    // Readiness is sent after the listener, WASM, meshes and GPU are all ready.
    window.chrome?.webview?.postMessage('ready');
    render();requestAnimationFrame(frame);
    // Explicit browser test mode only, absent in the packaged navigation URL.
    if(new URLSearchParams(location.search).has('test'))window.previewTest={
        settings:s=>{paused=true;apply(validate(s)||defaults);},
        seek:ms=>{paused=true;run.seek(ms);elapsed=ms;render();},
        play:()=>{paused=false;last=0;},restart,
        state:()=>({cycles,applied,tick:run.tick,top:core.top,memory:core.x.memory.buffer.byteLength,errors:gpu.errors,path:run.path,settings:renderer.settings}),
        pixels:async()=>Array.from(await gpu.read()),
        stage,
    };
}
start().catch(fail);
