// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import language from '../language-profiles.json';
import vision from '../vision-compatible-profile.json';
import originalVision from '../vision-profile.json';
import decisions from '../decision-profiles.json';
import continuousSpeech from '../../speech/continuous-profile.json';

export interface Artifact {
  id: string; url: string; bytes: number; sha256: string;
  kind: 'weights' | 'runtime' | 'notice' | 'data';
  parts?: { url: string; bytes: number }[];
}
export interface Progress { message: string; received?: number; total?: number }
interface FilePin { file: string; bytes: number; sha256: string; url?: string; parts?: {url:string;bytes:number}[] }
interface ModelPin {
  id: string; label?: string; model: string; revision: string; file?: string;
  weight_bytes: number; weight_sha256?: string; files?: FilePin[];
  engine: string; runtime_source?: { repository?: string; revision?: string; file?: string; sha256?: string };
}
// Both image variants use the same immutable metadata/tokenizer revision.
const metadata = vision.files.filter(file => !file.file.startsWith('onnx/'));
export const storageProfiles: readonly ModelPin[] = [...language, {...vision, id: 'image:compatible'},
  {...originalVision, id: 'image:fp16', files: [...originalVision.files, ...metadata]},
  ...decisions.filter(profile => ['shared-fp32-gpu-v1','strands-int4-fp32-v1'].includes(profile.native_variant ?? '')).map(profile => ({...profile,
    id: 'decision:' + profile.id, weight_bytes: profile.browser_probe.weight_bytes})),continuousSpeech] as ModelPin[];
export function profileById(id: string): ModelPin {
  const profile = storageProfiles.find(item => item.id === id);
  if (!profile) throw new Error('Verified installation is not available for this model.');
  return profile;
}
const publisherURL = (model: string, revision: string, file: string) => `https://huggingface.co/${model}/resolve/${revision}/${file}`;
const strandsRoot='https://code.superduper.solutions/browser-models/strands-fp32/9c3589ba48ec3be7a565b52a2fbd0687e30ffe0222c2b3a29d94b569062daf30/';
const speechDecoder='https://code.superduper.solutions/speech/models/8a8957dbe0eb8dcb49fac13f5b2db42e7c448a4dd10a24d27e0fc32189a8ec26/decoder-single-step.int8-fp32.onnx';

/** The catalog owns identities; callers cannot supply an installation URL. */
export function artifactsFor(profile: ModelPin): Artifact[] {
  const known = profileById(profile.id);
  const files: FilePin[] = known.files ?? [{file: known.file!, bytes: known.weight_bytes, sha256: known.weight_sha256!}];
  const result: Artifact[] = files.map(file => ({id: file.file,
    url: file.url ?? publisherURL(known.model, known.revision, file.file), bytes: file.bytes, sha256: file.sha256,
    kind: file.bytes >= 8 * 1024 * 1024 ? 'weights' : 'data',...(file.parts?{parts:file.parts.map(part=>({...part}))}:{})}));
  if (known.engine === 'webml') {
    const runtime = known.runtime_source!;
    result.push({id: 'webml-js', url: publisherURL(`spaces/${runtime.repository}`, runtime.revision!, runtime.file!),
      bytes: 2208435, sha256: runtime.sha256!, kind: 'runtime'});
  }
  for (const file of result) {
    if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0 || !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !(known.id==='decision:strands-fp32' ? file.url.startsWith(strandsRoot) && file.url===strandsRoot+file.id :
        known.id===continuousSpeech.id && file.url===speechDecoder ? file.sha256==='8a8957dbe0eb8dcb49fac13f5b2db42e7c448a4dd10a24d27e0fc32189a8ec26' : /^https:\/\/huggingface\.co\/.+\/resolve\/[a-f0-9]{40}\//.test(file.url)))
      throw new Error('The model does not have a complete immutable artifact pin.');
    if(file.parts && known.id===continuousSpeech.id) {
      if(file.url!==speechDecoder || file.parts.length!==1 || file.parts[0]?.url!==file.url || file.parts[0]?.bytes!==file.bytes)
        throw new Error('The speech decoder does not have a complete immutable download pin.');
    } else if(file.parts && (known.id!=='decision:strands-fp32' || file.parts.reduce((sum,part)=>sum+part.bytes,0)!==file.bytes ||
      file.parts.some((part,index)=>!Number.isSafeInteger(part.bytes)||part.bytes<=0||part.bytes>16777216||(index<file.parts!.length-1&&part.bytes%8388608!==0)||part.url!==file.url+'.part-'+String(index+1).padStart(3,'0'))))
      throw new Error('The converted model does not have complete immutable part pins.');
  }
  return result;
}
