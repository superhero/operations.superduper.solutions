#!/bin/bash
set -euo pipefail
cd /work
git init wllama
git -C wllama remote add origin https://github.com/ngxson/wllama.git
git -C wllama fetch --depth 1 origin 3bb2a46f0dab0b924e8cd992b85e8881c3d3a859
git -C wllama checkout --detach FETCH_HEAD
mkdir -p wllama/llama.cpp
git -C wllama/llama.cpp init
git -C wllama/llama.cpp remote add origin https://github.com/ggml-org/llama.cpp.git
git -C wllama/llama.cpp fetch --depth 1 origin 19cce6919992fdffd92e0ac152caaf1e2b8f254e
git -C wllama/llama.cpp checkout --detach FETCH_HEAD
cd wllama
test "$(git rev-parse HEAD)" = 3bb2a46f0dab0b924e8cd992b85e8881c3d3a859
test "$(git -C llama.cpp rev-parse HEAD)" = 19cce6919992fdffd92e0ac152caaf1e2b8f254e
git apply --unidiff-zero /work/upstream-api.patch
# Wasm64 uses long long for int64_t; the unrelated DeepSeek unity TU mixes long literals.
python3 - <<'FIX'
from pathlib import Path
p=Path('llama.cpp/src/models/deepseek41.cpp')
s=p.read_text();old='std::max({ (n_tok + 63)/64, (INT64_C(1) << 26)/(n_idx_head*n_comp*n_stream), INT64_C(1) })'
assert s.count(old)==1
p.write_text(s.replace(old,old.replace('std::max(', 'std::max<int64_t>(')))
FIX
git apply /work/heap8.patch
git -C llama.cpp apply /work/queue-wait.patch
git -C llama.cpp apply /work/gpu-only.patch
if test -f /work/fwht.enabled; then
    git -C llama.cpp apply /work/fwht.patch
    git -C llama.cpp add -N ggml/src/ggml-webgpu/wgsl-shaders/fwht.wgsl
fi
mkdir -p build/emdawn
curl --fail --location --retry 2 -o build/emdawn.zip https://github.com/google/dawn/releases/download/v20260317.182325/emdawnwebgpu_pkg-v20260317.182325.zip
python3 - <<'PY'
import zipfile
import hashlib,pathlib
assert hashlib.sha256(pathlib.Path('build/emdawn.zip').read_bytes()).hexdigest() == '8dcae86c630d76b6794b271c6572becba36f4237d132bee121a56638c3d76575', 'Dawn archive changed'
with zipfile.ZipFile('build/emdawn.zip') as z:z.extractall('build/emdawn')
PY
emcmake cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DGGML_WEBGPU=ON -DGGML_WEBGPU_JSPI=ON -DEMDAWNWEBGPU_DIR=/work/wllama/build/emdawn/emdawnwebgpu_pkg -DWLLAMA_TEST_BACKEND=OFF
cmake --build build --target wllama -j 8
mkdir -p src/wasm
cp build/wllama.js build/wllama.wasm src/wasm/
npm ci --ignore-scripts --no-audit --no-fund
npm run build:glue
npm run build:worker
npm run build:tsup
mkdir -p /work/artifacts
cp esm/index.js src/wasm/wllama.wasm LICENCE /work/artifacts/
git diff --binary > /work/artifacts/upstream.patch
git -C llama.cpp diff --binary > /work/artifacts/llama-cpp.patch
if test -f /work/fwht.enabled; then
    cp /work/fwht.patch /work/artifacts/fwht.patch
    cp llama.cpp/ggml/src/ggml-webgpu/wgsl-shaders/fwht.wgsl /work/artifacts/fwht.wgsl
fi
python3 - <<'PY'
import hashlib,json,pathlib,subprocess
p=pathlib.Path('/work/artifacts')
d={'wllama':'3bb2a46f0dab0b924e8cd992b85e8881c3d3a859','declared_version':'3.12.0-source','llama_cpp':'19cce6919992fdffd92e0ac152caaf1e2b8f254e','original_llama_cpp':'5aeac37a35b44fde4bdffaec9159f2fcb253b622','change':'Update upstream llama.cpp for official LFM3 support (PR31252); no weight conversion.','emscripten':'4.0.20','dawn_tag':'v20260317.182325','dawn_zip_sha256':hashlib.sha256(pathlib.Path('build/emdawn.zip').read_bytes()).hexdigest(),'backend':'webgpu + wasm SIMD/pthreads','cpu_heap_max_gib':8,'shader_f16_required':False,'gpu_only_graph_audit':True,'input_embedding_device':'GPU','files':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in p.iterdir() if f.is_file()}}
d['inputs_sha256']={name:hashlib.sha256((pathlib.Path('/work')/name).read_bytes()).hexdigest() for name in ['build.sh','upstream-api.patch','heap8.patch','queue-wait.patch','gpu-only.patch','fwht.patch','fwht.enabled'] if (pathlib.Path('/work')/name).is_file()}
if (p/'fwht.patch').exists():
    d.update(optimization='webgpu-fwht-512',patch_sha256=hashlib.sha256((p/'fwht.patch').read_bytes()).hexdigest())
(p/'build-receipt.json').write_text(json.dumps(d,indent=2)+'\n')
PY
