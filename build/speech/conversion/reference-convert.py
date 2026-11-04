#!/usr/bin/env python3
"""Reproduce a local compatibility ONNX graph on sds-01; return metadata only."""
import hashlib,importlib.util,json,shutil,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
IMAGE='mcr.microsoft.com/playwright:v1.61.1-noble@sha256:cf0daee9b994042e011bc29f20cdff1a9f682a039b43fcd738f7d8a9d3bcd9d6'
def main():
 subprocess.run(['npm','ci','--ignore-scripts','--no-audit','--no-fund'],cwd=HERE,check=True)
 source=HERE/'.runtime/convert';source.mkdir(parents=True,exist_ok=True)
 parser=HERE/'node_modules/onnxruntime-web/lib/onnxjs/ort-schema/protobuf/onnx.js'
 assert hashlib.sha256(parser.read_bytes()).hexdigest()=='b6cb83ec708b51f5bcce8295a2dc1452e430d6c8696db2da68c5233d9359cb3f'
 shutil.copy2(parser,source/'onnx.cjs');shutil.copy2(HERE/'conversion/lower-decoder.cjs',source/'lower-decoder.cjs')
 (source/'package.json').write_text(json.dumps({'private':True,'dependencies':{'protobufjs':'7.5.4'}},indent=2)+'\n')
 (source/'build.sh').write_text("""#!/bin/bash
set -euo pipefail
cd /work
npm install --ignore-scripts --no-audit --no-fund
node - <<'JS'
(async()=>{const fs=require('fs'),c=require('crypto');const r=await fetch('https://huggingface.co/ysdede/parakeet-tdt-0.6b-v3-onnx/resolve/f88260fa0777fe0868dda6df85d1a98f012a4a7a/decoder_joint-model.int8.onnx',{signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error('HTTP '+r.status);const b=Buffer.from(await r.arrayBuffer());if(b.length!==18202004||c.createHash('sha256').update(b).digest('hex')!=='eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70')throw Error('Source pin differs');fs.writeFileSync('/work/decoder.int8.onnx',b)})().catch(e=>{console.error(e);process.exit(1)});
JS
node lower-decoder.cjs /work/decoder.int8.onnx /work/models/decoder-single-step.int8-fp32.onnx
mkdir -p /work/artifacts
cp /work/models/decoder-single-step.int8-fp32.onnx.json /work/artifacts/conversion-receipt.json
""")
 spec=importlib.util.spec_from_file_location('speech_convert_remote',ROOT/'evaluations/browser-runtimes/runtime/build-remote.py');remote=importlib.util.module_from_spec(spec);spec.loader.exec_module(remote)
 return remote.run(source_dir=source,area='brave-speech-convert',image=IMAGE)
if __name__=='__main__':raise SystemExit(main())
