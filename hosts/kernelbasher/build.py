"""Assemble offline assets. --recompile rebuilds the bundled WASM with LLVM clang.

Upstream sources stay unmodified; the sole C adapter makes Blob.c's radius a
runtime value. Prebuilt WASM is hash checked, so ordinary Windows builds need
only MSVC and Python. Set XBOOT_CLANG to rebuild with another clang installation.
"""
from pathlib import Path
import hashlib, importlib.util, json, os, re, shutil, struct, subprocess, sys

ROOT=Path(__file__).resolve().parents[2]
UP=ROOT
PRE=ROOT/'hosts/kernelbasher'
OUT=ROOT/'out/kernelbasher'

def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def rebuild():
    clang=os.environ.get('XBOOT_CLANG',str(ROOT/'.tools/llvm/bin/clang.exe'))
    spec=importlib.util.spec_from_file_location('upstream_build',UP/'core/build.py')
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    work=ROOT/'out/kernelbasher-core';work.mkdir(parents=True,exist_ok=True)
    blob=(UP/'core/src/Blob.c').read_text()
    assert '#define B_RADIUS    2.3f' in blob
    blob=blob.replace('#define B_RADIUS    2.3f','extern float kb_radius;\n#define B_RADIUS    kb_radius')
    (work/'Blob.c').write_text(blob)
    (work/'radius.c').write_text('float kb_radius = 2.3f;\nvoid kb_set_radius(float radius) { kb_radius = radius > 0.000001f ? radius : 0.000001f; }\n')
    sources=[str(work/'Blob.c') if p=='core/src/Blob.c' else p for p in mod.CORE]
    wasm=PRE/'xboot.wasm'
    cmd=[clang]+mod.WASM+['-Icore/src','-mbulk-memory','-Wl,--export=kb_set_radius']+sources+[str(work/'radius.c'),'-o',str(wasm)]
    subprocess.run(cmd,cwd=UP,check=True)
    assert mod.wasm_imports(wasm)==0
    (PRE/'xboot.wasm.sha256').write_text(digest(wasm)+'\n')

def main():
    PRE.mkdir(parents=True,exist_ok=True)
    if '--recompile' in sys.argv:rebuild()
    wasm=PRE/'xboot.wasm'
    if not wasm.exists():raise SystemExit('Run python hosts/kernelbasher/build.py --recompile with XBOOT_CLANG set to clang.exe first.')
    assert digest(wasm)==(PRE/'xboot.wasm.sha256').read_text().strip(),'Bundled WASM hash mismatch'
    OUT.mkdir(parents=True,exist_ok=True)
    subprocess.run([sys.executable,str(UP/'tools/pack/pack.py'),'--check'],check=True,cwd=UP)
    shutil.copy2(UP/'out/pack/xboot.pak',OUT/'xboot.pak')
    for name in ['index.html','preview.css','preview.js','settings.js','xboot.wasm','xboot.wasm.sha256']:
        shutil.copy2(PRE/name,OUT/name)
    shutil.copytree(UP/'hosts/web/src',OUT/'upstream',dirs_exist_ok=True)
    shutil.copy2(UP/'hosts/web/layout.json',OUT/'layout.json')
    shutil.copy2(UP/'LICENSE',OUT/'LICENSE-xbox-boot-re.txt')
    shutil.copy2(UP/'docs/provenance.md',OUT/'upstream-provenance.md')
    shutil.copy2(ROOT/'data/kernelbasher/torn.json',OUT/'torn.json')
    print('Offline preview assets:',OUT)

if __name__=='__main__':main()
