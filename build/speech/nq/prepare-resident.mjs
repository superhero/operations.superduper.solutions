// Local, bounded transport adapter; trained graphs and upstream greedy loop stay unchanged.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const upstream=new URL('./node_modules/parakeet.js/src/parakeet.js',import.meta.url);
const bytes=await readFile(upstream);
if(hash(bytes)!=='74e175f9e4d6adbcd77572cb84aba79570f1f80cc76e4deb6c34c12286b9b636')throw Error('Parakeet source pin differs');
const original=bytes.toString().replace(/\r\n/g,'\n');let source=original;
const start='    // Transpose encoder output [B, D, T] -> [T, D] for B=1';
const end='    // --- Decode frame-by-frame';
const a=source.indexOf(start),b=source.indexOf(end,a);if(a<0||b<a)throw Error('Encoder adapter anchors differ');
source=source.slice(0,a)+`    // NO: encoder output stays on GPU; gather one frame into a persistent GPU input.
    const [, D, Tenc] = enc.dims;
    if (!this._residentDecoder || enc.location !== 'gpu-buffer') throw new Error('Resident encoder output must stay on GPU');
    this._residentDecoder.bindEncoder(enc);
    this._encoderFrameTensor = this._residentDecoder.frameTensor;

`+source.slice(b);
const copy='      this._encoderFrameBuffer.set(transposed.subarray(frameStart, frameStart + D));';
if(source.split(copy).length!==2)throw Error('Frame adapter anchor differs');
source=source.replace(copy,'      this._residentDecoder.selectFrame(t);');
const timing='    if (perfEnabled) {\n      tDecode = performance.now() - decStartTime;\n    }';
if(source.split(timing).length!==2)throw Error('Encoder release anchor differs');
source=source.replace(timing,'    this._residentDecoder.releaseEncoder();\n\n'+timing);
const loopStart=original.indexOf('      const prevTok = ids.length ? ids[ids.length - 1] : this.blankId;');
const loopEnd=original.indexOf(timing,loopStart);const greedy=original.slice(loopStart,loopEnd);
if(loopStart<0||loopEnd<loopStart||!source.includes(greedy))throw Error('Original greedy/blank/state/duration loop changed');
// Resolve unchanged upstream support modules from the pinned installed package.
source=source.replace(/from '(\.\/[^']+)'/g,(_,relative)=>'from '+JSON.stringify(fileURLToPath(new URL(relative,upstream))));
const generated=new URL('./.runtime/resident-parakeet.js',import.meta.url);await mkdir(new URL('./.runtime/',import.meta.url),{recursive:true});await writeFile(generated,source);
const proof={package:'parakeet.js',version:'1.4.4',original_file_sha256:hash(bytes),generated_module_sha256:hash(source),normalization:'CRLF to LF after validating original byte hash',original_greedy_state_commit_duration_loop_sha256:hash(greedy),original_greedy_state_commit_duration_loop_preserved:true,patches:['Replace CPU encoder transpose/buffer setup with GPU tensor binding','Replace CPU frame copy with GPU frame gather','Release resident encoder after unchanged decode loop'],imports:'Unchanged support modules resolved to pinned package paths',graphs_and_weights_changed:false};
const attempt=new URL('../../../attempts/no-browser-parakeet-resident-gpu/',import.meta.url);await mkdir(attempt,{recursive:true});await writeFile(new URL('adapter-proof.json',attempt),JSON.stringify(proof,null,2)+'\n');
