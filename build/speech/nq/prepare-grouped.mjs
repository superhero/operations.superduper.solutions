import {readFile,writeFile,mkdir} from 'node:fs/promises';import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');const np=await readFile(new URL('./.runtime/selection-parakeet.js',import.meta.url),'utf8');let source=np;
const transcribe='  async transcribe(audio, sampleRate = 16000, opts = {}) {';
source=source.replace(transcribe,transcribe+`\n    if((opts.frameStride??1)!==1 || (opts.temperature??1)!==1 || this.maxTokensPerStep!==10) throw new Error('Grouped GPU control requires frameStride1, temperature1, maxTokensPerStep10');`);
const a=source.indexOf('    for (let t = startFrame; t < Tenc;) {'),b=source.indexOf('    this._residentDecoder.retainFinalState(decoderState);',a);if(a<0||b<a)throw Error('Grouped decode loop anchors differ');
source=source.slice(0,a)+`    // NQ: GPU owns selection, blank commitment, target, frame and done; JS submits bounded groups.
    const grouped = await this._residentDecoder.runGrouped();
    for (const record of grouped.records) {
      if (record.token === this.blankId) continue;
      ids.push(record.token);
      if(returnFrameIndices) tokenFrameIndices.push(record.frame);
      if(returnTdtSteps) tokenTdtSteps.push(record.duration);
      if(returnTimestamps){
        const durFrames = record.duration > 0 ? record.duration : 1;
        const endFrame = Math.min(Tenc, record.frame + Math.max(1, durFrames));
        tokenTimes.push([effectiveTimeOffset + record.frame * TIME_STRIDE,effectiveTimeOffset + endFrame * TIME_STRIDE]);
      }
    }
`+source.slice(b);
await writeFile(new URL('./.runtime/grouped-parakeet.js',import.meta.url),source);const attempt=new URL('../../../attempts/nq-browser-parakeet-grouped-gpu/',import.meta.url);await mkdir(attempt,{recursive:true});await writeFile(new URL('adapter-proof.json',attempt),JSON.stringify({package:'parakeet.js',version:'1.4.4',np_source_sha256:hash(np),grouped_source_sha256:hash(source),original_whole_greedy_loop_preserved:false,control_reimplemented_on_gpu:true,original_postprocessing_preserved:true,scope:'Fixed independent75-frame encoder output, frameStride1, temperature1, maxTokensPerStep10, group4, no confidence/logProb/incremental modes',semantics:'Strict first-index argmax; nonblank state commit before frame/done; padded calls cannot emit or mutate final state',graphs_and_weights_changed:false},null,2)+'\n');
