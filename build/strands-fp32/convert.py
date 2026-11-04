#!/usr/bin/env python3
"""Local compatibility conversion on sds-01: retain INT4, losslessly upcast FP16 support tensors."""
import collections,hashlib,json,shutil,urllib.request
from pathlib import Path
import numpy as np
import onnx
from onnx import numpy_helper

BASE='https://huggingface.co/alxnahas/strands-decider-webgpu-ci/resolve/b08c4c84e3380ca86cc3990208a6dc070f427bd5/strands-decider-2B-qwen3.5-v1-2610/e7b1933c8a81/81a60500ec/'
EXPECTED_MANIFEST='d855ce380cf949b6a0b8d549e8f83f99fb9a369f9e537ff5230f67e54966d444'
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for chunk in iter(lambda:f.read(8<<20),b''):h.update(chunk)
 return h.hexdigest()
def write(p,v):p.write_text(json.dumps(v,indent=2,sort_keys=True)+'\n')
def main():
 source=Path('/work/original');dest=Path('/work/weights');artifacts=Path('/work/artifacts')
 source.mkdir(exist_ok=True);dest.mkdir(exist_ok=True);artifacts.mkdir(exist_ok=True)
 manifest_path=source/'manifest.json'
 urllib.request.urlretrieve(BASE+'manifest.json',manifest_path)
 if not EXPECTED_MANIFEST or sha(manifest_path)!=EXPECTED_MANIFEST:raise ValueError('Pinned contributor manifest mismatch')
 original=json.loads(manifest_path.read_text());manifest=json.loads(json.dumps(original))
 for name,pin in original['files'].items():
  path=source/name;path.parent.mkdir(parents=True,exist_ok=True)
  if not path.is_file() or path.stat().st_size!=pin['bytes'] or sha(path)!=pin['sha256']:
   print('Downloading authorized pinned file:',name,flush=True);urllib.request.urlretrieve(BASE+name,path)
  assert path.stat().st_size==pin['bytes'] and sha(path)==pin['sha256'],name
  if not name.startswith('onnx/'):
   target=dest/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,target)
 model=onnx.load(source/original['graph'],load_external_data=True)
 ops=collections.Counter(n.domain+'::'+n.op_type for n in model.graph.node)
 print('Graph operators:',json.dumps(ops,sort_keys=True),flush=True)
 integer_before={t.name:hashlib.sha256(numpy_helper.to_array(t).tobytes()).hexdigest() for t in model.graph.initializer if t.data_type not in (1,10,11,16)}
 changes=collections.Counter()
 def visit(message):
  if isinstance(message,onnx.TensorProto):
   name=message.name;array=numpy_helper.to_array(message)
   if message.data_type==onnx.TensorProto.FLOAT16:
    upcast=array.astype(np.float32)
    assert np.array_equal(upcast.astype(np.float16),array,equal_nan=True),name
    array=upcast;changes['fp16_tensors_upcast']+=1
   message.CopyFrom(numpy_helper.from_array(array,name=name));return
  if isinstance(message,onnx.TypeProto.Tensor) and message.elem_type==onnx.TensorProto.FLOAT16:
   message.elem_type=onnx.TensorProto.FLOAT;changes['tensor_type_annotations']+=1
  if isinstance(message,onnx.NodeProto):
   for attr in message.attribute:
    if attr.name in ('to','dtype') and attr.type==onnx.AttributeProto.INT and attr.i==onnx.TensorProto.FLOAT16:
     attr.i=onnx.TensorProto.FLOAT;changes['cast_or_dtype_attributes']+=1
  for field,value in message.ListFields():
   if field.type==field.TYPE_MESSAGE:
    if field.is_repeated:
     for child in value:visit(child)
    else:visit(value)
 visit(model)
 integer_after={t.name:hashlib.sha256(numpy_helper.to_array(t).tobytes()).hexdigest() for t in model.graph.initializer if t.name in integer_before}
 assert integer_after==integer_before,'Packed INT4/integer parameter bytes changed'
 graph=dest/original['graph'];graph.parent.mkdir(exist_ok=True)
 (graph.parent/'model.onnx.data').unlink(missing_ok=True)
 onnx.save_model(model,graph,save_as_external_data=True,all_tensors_to_one_file=True,location='model.onnx.data',size_threshold=1024,convert_attribute=True)
 checker_note='passed'
 try:onnx.checker.check_model(str(graph))
 except onnx.checker.ValidationError as error:
  # The contributor graph uses an ORT fused op in the default ONNX domain.
  # Accept only the identical known checker limitation in the untouched graph;
  # actual ORT session creation and six native forwards remain mandatory.
  expected='No Op registered for SimplifiedLayerNormalization with domain_version of 22'
  if not str(error).startswith(expected):raise
  try:onnx.checker.check_model(str(source/original['graph']))
  except onnx.checker.ValidationError as baseline_error:
   if not str(baseline_error).startswith(expected):raise
  else:raise ValueError('Converted graph introduced a new checker failure')
  checker_note=expected+'; unchanged upstream limitation; validate in actual ORT WebGPU'
 manifest['shards']=[str((graph.parent/'model.onnx.data').relative_to(dest))]
 for value in manifest['state_inputs'].values():
  if value['dtype']=='float16':value['dtype']='float32'
 manifest['files']={str(p.relative_to(dest)):{'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(dest.rglob('*')) if p.is_file() and p.name!='manifest.json'}
 proof={'format':'INT4 packed parameters / FP32 computation support','kind':'local compatibility conversion, not an official FP32 release','input_manifest_sha256':EXPECTED_MANIFEST,'source_url':BASE,'changes':dict(changes),'integer_parameter_sha256':integer_before,'integer_parameters_identical':True,'original_bytes':sum(x['bytes'] for x in original['files'].values()),'converted_bytes':sum(x['bytes'] for x in manifest['files'].values()),'operators':dict(ops),'onnx':onnx.__version__,'numpy':np.__version__,'onnx_checker':checker_note}
 manifest['compatibility_conversion']={k:v for k,v in proof.items() if k!='integer_parameter_sha256'}
 write(dest/'manifest.json',manifest);shutil.copy2(dest/'manifest.json',artifacts/'manifest.json')
 proof['output_manifest_sha256']=sha(dest/'manifest.json');write(artifacts/'conversion-receipt.json',proof)
 print(json.dumps({k:v for k,v in proof.items() if k not in ('integer_parameter_sha256','operators')},indent=2),flush=True)
if __name__=='__main__':main()
