# KernelBasher live preview

This host is the animation preview used by [KernelBasher](https://github.com/yosaito/kernelbasher).
It builds on [bennyborn/xbox-boot-re](https://github.com/bennyborn/xbox-boot-re)
at `12a3396aa77f72c8d2fd94c0988c7e11539b47e7`. The upstream C core and web
renderer stay unchanged. The adapter adds live colours, radius, camera and
wireframe settings, custom lettering meshes, Torn-X geometry, silent looping,
and a WebView2 settings bridge.

The files `index.html`, `preview.css`, `preview.js`, `settings.js`, `xboot.wasm`
and `xboot.wasm.sha256` match KernelBasher's `src/preview/` snapshot at commit
`b068b018f3147a9bcfaa96ac6390e1b864b3de3a`. Native dialog hosting and BIOS
patching belong to the KernelBasher repository.

## Build and run

From this repository's root, with Python 3:

```sh
python hosts/kernelbasher/build.py
python -m http.server 8361 --bind 127.0.0.1 --directory out/kernelbasher
```

Open `http://localhost:8361/` in a WebGPU-capable browser. The WebView2 host
sends settings as JSON messages; the standalone page initially uses defaults.
No BIOS file or server-side patcher is needed for the preview.

The normal build verifies the supplied WASM and upstream data-pack hashes.
To rebuild the WASM, set `XBOOT_CLANG` to LLVM clang and run:

```sh
python hosts/kernelbasher/build.py --recompile
```

LLVM 23.1.3 with wasm-ld was used. The script generates a private copy of
`Blob.c` under `out/kernelbasher-core/`, replaces the fixed radius with a
runtime value, and exports `kb_set_radius`. Strict upstream floating-point
flags and `-mbulk-memory` match the Windows application's preview build.

## Tests

With Playwright and Microsoft Edge installed:

```sh
node hosts/kernelbasher/test.mjs
```

Set `PLAYWRIGHT_MODULE` to an existing Playwright installation when necessary.
The test checks pixel changes for colours, radius, opacity, cameras, wireframe,
white backgrounds, Torn-X and custom lettering, plus deterministic restoration,
stable WASM allocation and two automatic loops. Results and screenshots go to
`out/kernelbasher-test/`.

This is a Complex 4627 reference renderer. It does not establish that every
patched BIOS renders identically on hardware. Camera choices 1–6 preserve the
original KernelBasher patcher's shared-path behaviour; 7 and 8 select distinct
paths. X-file lettering replaces the text mesh in the final logo phase.

The upstream license and provenance remain in the repository. The additional
Torn-X geometry is recorded separately under `data/kernelbasher/`, within the
data exclusion described by the upstream license.
