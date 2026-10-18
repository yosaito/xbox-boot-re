// Display adapter only. It cannot read or modify a BIOS file.
export const defaults = {type:'settings',colours:[25,255,70,25,255,70,25,255,70,25,255,70,25,255,70,25,255,70,255],radius:3.25,camera:1,random:0,wire:0,whiteAnimation:0,whiteSplash:0,keepMachinery:0,torn:0,logo:null};
export function validate(s) {
    if(!s || s.type!=='settings' || !Array.isArray(s.colours) || s.colours.length!==19 || !s.colours.every(n=>Number.isInteger(n)&&n>=0&&n<=255))return null;
    if(!Number.isFinite(s.radius)||s.radius<0||s.radius>6.375||!Number.isInteger(s.camera)||s.camera<1||s.camera>8)return null;
    for(const k of ['random','wire','whiteAnimation','whiteSplash','keepMachinery','torn'])if(![0,1,false,true].includes(s[k]))return null;
    if(s.logo){
        const {vertices:v,indices:i}=s.logo;
        if(!Array.isArray(v)||v.length<6||v.length>468||v.length%3||!v.every(n=>Number.isFinite(n)&&Math.abs(n)<=3276.7))return null;
        if(!Array.isArray(i)||i.length<3||i.length>465||i.length%3||!i.every(n=>Number.isInteger(n)&&n>=0&&n<v.length/3))return null;
    }
    return structuredClone(s);
}
export function cameraPath(s, random=Math.random) {
    // Original patch bytes: 7 -> 1, 8 -> 3; the 1..6 branch compares ASCII
    // to numeric digits and is unreachable. Random chooses the four ROM paths.
    return s.random ? Math.min(3,Math.floor(random()*4)) : s.camera===7 ? 1 : s.camera===8 ? 3 : 0;
}
export function logoVertices(values) {
    // Same int16 quantisation as prepare_logo(), then the BIOS lettering decoder.
    return Float32Array.from(values,n=>{
        const x=n < -100 ? n*0.010245901639344263 : n;
        const packed=(Math.trunc(x*398.72408293460927)<<16)>>16;
        return Math.fround(packed*Math.fround(0.00250800001)+Math.fround(41.0653687));
    });
}
