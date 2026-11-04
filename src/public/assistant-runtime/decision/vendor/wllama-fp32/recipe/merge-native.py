#!/usr/bin/env python3
"""Combine independently verified native API patches without changing their bodies."""
import difflib,hashlib,json,shutil,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(sys.argv[1]).resolve()
RECIPES=Path(__file__).resolve().parent
FILES=['cpp/wllama-context.h','cpp/wllama.cpp','src/wllama.ts']
PATCHES=['d3-inspect.patch','knowline-safe-json.patch','elephant-context.patch','pplx-context.patch']
base={name:(ROOT/name).read_text().splitlines(True) for name in FILES}
edits={name:[] for name in FILES}
for patch in PATCHES:
 with tempfile.TemporaryDirectory(prefix='native-api-merge-') as temporary:
  target=Path(temporary)
  for name in FILES:
   p=target/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(''.join(base[name]))
  subprocess.run(['patch','--batch','--fuzz=0','--silent','-p1','-i',str(RECIPES/patch)],cwd=target,check=True)
  for name in FILES:
   after=(target/name).read_text().splitlines(True)
   for tag,start,end,new_start,new_end in difflib.SequenceMatcher(None,base[name],after,autojunk=False).get_opcodes():
    if tag!='equal':edits[name].append((start,end,after[new_start:new_end],patch))
for name in FILES:
 output=[];position=0
 for start,end,lines,patch in sorted(edits[name],key=lambda e:(e[0],e[1])):
  if start<position:raise ValueError('Conflicting API edits: '+name+' '+patch)
  output.extend(base[name][position:start]);output.extend(lines);position=end
 output.extend(base[name][position:]);(ROOT/name).write_text(''.join(output))
proof={'input_patches':{p:hashlib.sha256((RECIPES/p).read_bytes()).hexdigest() for p in PATCHES},
       'combined_files':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in FILES},
       'meaning':'Union of independently applied native API edits; overlapping replacements are rejected'}
(ROOT/'native-api-merge.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(proof),flush=True)
