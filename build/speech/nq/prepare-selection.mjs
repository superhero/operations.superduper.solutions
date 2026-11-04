import {readFile,writeFile,mkdir} from 'node:fs/promises';import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const no=await readFile(new URL('./.runtime/resident-parakeet.js',import.meta.url),'utf8');let source=no;
const begin=source.indexOf('  async _runCombinedStep('),end=source.indexOf('  /**\n   * Copy decoder state tensors',begin);
if(begin<0||end<begin)throw Error('Selection adapter method anchors differ');
source=source.slice(0,begin)+`  async _runCombinedStep(encTensor, token, currentState = null) {
    this._targetIdArray[0] = typeof token === 'number' ? token : this.blankId;
    const out = await this.joinerSession.run({encoder_outputs:encTensor,targets:this._targetTensor,target_length:this._targetLenTensor,input_states_1:currentState?.state1 || this._combState1,input_states_2:currentState?.state2 || this._combState2});
    return {tokenLogits:null,step:out.selection.duration,newState:{state1:out.output_states_1,state2:out.output_states_2},_selection:out.selection};
  }

`+source.slice(end);
const transcribe='  async transcribe(audio, sampleRate = 16000, opts = {}) {';
source=source.replace(transcribe,transcribe+`\n    if(opts.returnConfidences || opts.returnLogProbs || opts.returnDecoderState || opts.previousDecoderState || opts.incremental || (opts.prefixSamples??0)>0) throw new Error('Compact GPU selection does not support confidence/logProb or incremental state options');`);
source=source.replace('const { tokenLogits, step, newState, _logitsTensor } = await this._runCombinedStep','const { tokenLogits, step, newState, _logitsTensor, _selection } = await this._runCombinedStep');
const a=source.indexOf('      // Temperature scaling & argmax'),b=source.indexOf('      // Compute maxVal (scaled)',a);if(a<0||b<a)throw Error('CPU argmax anchors differ');
source=source.slice(0,a)+'      // NP: IDs come from exact first-index GPU argmax, no CPU logit scan.\n      let maxLogit = _selection.maxLogit, maxId = _selection.token;\n\n'+source.slice(b);
source=source.replace('    this._residentDecoder.releaseEncoder();','    this._residentDecoder.retainFinalState(decoderState);\n    this._residentDecoder.releaseEncoder();');
const controlStart=no.indexOf('      if (maxId !== this.blankId) {'),controlEnd=no.indexOf('      // Capture decoder state at end of prefix',controlStart);const control=no.slice(controlStart,controlEnd);if(controlStart<0||controlEnd<controlStart||!source.includes(control))throw Error('Original state/duration branch changed');
const generated=new URL('./.runtime/selection-parakeet.js',import.meta.url);await writeFile(generated,source);
const attempt=new URL('../../../attempts/np-browser-parakeet-selection-gpu/',import.meta.url);await mkdir(attempt,{recursive:true});await writeFile(new URL('adapter-proof.json',attempt),JSON.stringify({package:'parakeet.js',version:'1.4.4',original_source_sha256:'74e175f9e4d6adbcd77572cb84aba79570f1f80cc76e4deb6c34c12286b9b636',resident_source_sha256:hash(no),selection_source_sha256:hash(source),original_whole_greedy_loop_preserved:false,original_state_commit_duration_branch_preserved:true,original_state_commit_duration_branch_sha256:hash(control),patches:['Direct GPU preselected IDs instead of CPU argmax/duration scans','Explicitly reject confidence/logProb/incremental options','Optional untimed final GPU state snapshot before original cleanup'],graphs_and_weights_changed:false},null,2)+'\n');
