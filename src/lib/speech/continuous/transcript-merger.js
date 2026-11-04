// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Adapted from llm-sds-01; continuous-sources.json preserves source provenance.
/** Append-only transcript merging for20s cores with2s overlapping input.
 * Words enter in segment-local seconds and leave in absolute audio seconds.
 * Retained state is one segment's provisional words plus a bounded committed
 * tail; the caller owns complete transcript fragments. Rotation holds the final
 * second for the next segment. Finalized audio also seals decoded silence,
 * bounded before any unresolved word. Natural pauses may commit through decoded audio;
 * stop waits for finish() after every recognition segment has drained.
 */
const EPS=1e-7;
const closing=/^[,.;:!?…，。！？；：)\]}]+$/u;
const opening=/[(\[{“«]$/u;
const sentenceEnd=/[.!?…。！？][”’"')\]}]*$/u;
const norm=text=>text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu,'');
function finite(value,label){if(typeof value!=='number'||!Number.isFinite(value))throw TypeError(`${label} must be finite`);return value;}
function overlap(a,b){return Math.max(0,Math.min(a.end_time,b.end_time)-Math.max(a.start_time,b.start_time));}
function samePosition(a,b){
 const width=Math.min(a.end_time-a.start_time,b.end_time-b.start_time);
 if(width<=EPS)return Math.abs(a.start_time-b.start_time)<=EPS&&Math.abs(a.end_time-b.end_time)<=EPS;
 return overlap(a,b)/width>=.5&&Math.abs(a.start_time-b.start_time)<=.25&&Math.abs(a.end_time-b.end_time)<=.25;
}
const equivalent=(a,b)=>a._norm===b._norm&&samePosition(a,b);
function conflicts(a,b){
 if(equivalent(a,b))return true;
 const small=Math.min(a.end_time-a.start_time,b.end_time-b.start_time);
 if(small<=EPS||overlap(a,b)/small<.6||Math.abs(a.start_time-b.start_time)>.25)return false;
 const prefix=Math.min(a._norm.length,b._norm.length)>=2&&(a._norm.startsWith(b._norm)||b._norm.startsWith(a._norm));
 const union=Math.max(a.end_time,b.end_time)-Math.min(a.start_time,b.start_time);
 return prefix||overlap(a,b)/union>=.6;
}
function textFragment(words,previous=''){
 let output='',last=previous;
 for(const word of words){
  const token=word.text;
  const separator=last&&!closing.test(token)&&!opening.test(last)?' ':'';
  output+=separator+token;last=token;
 }
 return output;
}
const plain=word=>({text:word.text,start_time:word.start_time,end_time:word.end_time});

export function createTranscriptMerger({sampleRate=16000,overlapSeconds=2,holdbackSeconds=overlapSeconds/2,dedupTailWords=12}={}){
 if(!Number.isSafeInteger(sampleRate)||sampleRate<=0)throw RangeError('sampleRate must be a positive integer');
 finite(overlapSeconds,'overlapSeconds');finite(holdbackSeconds,'holdbackSeconds');
 if(overlapSeconds<0||holdbackSeconds<0||holdbackSeconds>overlapSeconds)throw RangeError('holdback must fit within overlap');
 if(!Number.isSafeInteger(dedupTailWords)||dedupTailWords<1)throw RangeError('dedupTailWords must be positive');
 let provisional,tail,active,committedThrough,finalizedAudioThrough,sequence,committedWordCount,finished,peakRetainedWordCount,latestHorizon;
 function reset(){provisional=[];tail=[];active=null;committedThrough=0;finalizedAudioThrough=0;sequence=0;committedWordCount=0;finished=false;peakRetainedWordCount=0;latestHorizon=0;return getState();}
 function retainPeak(){peakRetainedWordCount=Math.max(peakRetainedWordCount,provisional.length+tail.length);}
 function getState(){return{activeSegmentId:active?.id??null,activeAudioStartSample:active?.start??null,decodedThroughSeconds:active?.decoded??null,latestGlobalHorizon:latestHorizon,committedThrough,finalizedAudioThrough,sequence,committedWordCount,provisionalWordCount:provisional.length,committedTailWordCount:tail.length,retainedWordCount:provisional.length+tail.length,peakRetainedWordCount,finished};}
 function result(words=[],ignored){
  const previous=tail.length?tail[tail.length-1].text:'';
  const delta=words.map(plain),text=textFragment(delta,previous);
  if(delta.length){
   sequence++;committedWordCount+=delta.length;
   committedThrough=Math.max(committedThrough,...delta.map(word=>word.end_time));
   tail=tail.concat(words).slice(-dedupTailWords).map(word=>({...word}));
  }
  retainPeak();
  return{stableDelta:{words:delta,text,sequence},draftText:textFragment(provisional),committedThrough,...(ignored?{ignored}: {})};
 }
 function commit(cutoff,force){
  let eligible=0,lastSentence=0;
  for(const word of provisional){
   if(word.end_time>cutoff+EPS||!force&&word._observations<2)break;
   eligible++;if(sentenceEnd.test(word.text))lastSentence=eligible;
  }
  const count=force?eligible:lastSentence;
  return count?provisional.splice(0,count):[];
 }
 function normalise(words,offset,decoded,key){
  if(!Array.isArray(words))throw TypeError('words must be an array');
  const input=[];
  for(const raw of words){
   if(!raw||typeof raw.text!=='string')throw TypeError('word text must be a string');
   const text=raw.text.trim();if(!text)continue;
   const start=finite(raw.start_time,'word start_time'),end=finite(raw.end_time,'word end_time');
   // Allow encoded-frame rounding at the edge, but detect already-global input.
   if(start< -EPS||end<start-EPS||end>decoded+.2)throw RangeError('word timestamps must be local to the decoded segment');
   const word={text,start_time:offset+Math.max(0,start),end_time:offset+Math.max(start,end),_norm:norm(text),_observations:1,_observation:key};
   if(word.end_time<=Math.max(committedThrough,finalizedAudioThrough)+EPS)continue;
   const width=word.end_time-word.start_time;
   // Repeated context can stretch a word's end considerably when the next
   // segment gains right context. Match its onset and majority of its actual
   // duration to a committed word, rather than requiring both ends to agree.
   // A later genuine repetition has its own time span and remains distinct.
   if(width>EPS&&tail.some(old=>old._norm===word._norm&&Math.abs(old.start_time-word.start_time)<=.25+EPS&&overlap(old,word)/width>=.5))continue;
   const old=provisional.find(previous=>equivalent(previous,word));
   if(old){word._observations=old._observations+(old._observation!==key?1:0);}
   input.push(word);
  }
  return input.sort((a,b)=>a.start_time-b.start_time);
 }
 function update(payload){
  if(!payload||typeof payload!=='object')throw TypeError('update payload required');
  if(finished)return result([],'finished');
  const {segmentId,audioStartSample,reason='partial'}=payload;
  if(!(typeof segmentId==='string'&&segmentId||typeof segmentId==='number'&&Number.isFinite(segmentId)))throw TypeError('segmentId must identify the recognition segment');
  if(!Number.isSafeInteger(audioStartSample)||audioStartSample<0)throw RangeError('audioStartSample must be nonnegative');
  const decoded=finite(payload.decodedThroughSeconds,'decodedThroughSeconds');if(decoded<0)throw RangeError('decoded horizon must be nonnegative');
  if(!['partial','rotation','stop'].includes(reason))throw RangeError('unknown transcript update reason');
  if(active&&audioStartSample<active.start)return result([],'retired-segment');
  if(active&&audioStartSample===active.start&&segmentId!==active.id)return result([],'segment-id-mismatch');
  if(active&&audioStartSample===active.start&&decoded<active.decoded-EPS)return result([],'regressed-horizon');
  const offset=audioStartSample/sampleRate,horizon=offset+decoded,key=`${audioStartSample}:${decoded}`;
  const input=normalise(payload.words,offset,decoded,key);
  active={id:segmentId,start:audioStartSample,decoded};latestHorizon=Math.max(latestHorizon,horizon);
  if(input.length){
   // An incoming prefix cannot delete older words outside its decoded horizon
   // or a word cut by the new segment's left boundary.
   const retained=provisional.filter(word=>word.end_time>horizon+EPS||word.start_time<offset-EPS);
   provisional=retained.concat(input.filter(word=>!retained.some(old=>conflicts(old,word)))).sort((a,b)=>a.start_time-b.start_time);
   retainPeak();
  }
  let committed=[];
  if(reason==='rotation'){
   const cutoff=horizon-holdbackSeconds;
   committed=commit(cutoff,true);
   // A successor can revise the held tail, but cannot insert fresh words into
   // finalized silence. Stop before a straddling word so its correction remains
   // possible even when the successor timestamps its end before the cutoff.
   finalizedAudioThrough=Math.max(finalizedAudioThrough,Math.min(cutoff,provisional[0]?.start_time??Infinity));
  }
  else if(reason==='partial'&&payload.naturalPause===true)committed=commit(horizon,true);
  else if(reason==='partial'&&input.length)committed=commit(horizon-holdbackSeconds,false);
  return result(committed);
 }
 function finish(){if(finished)return result([],'finished');finished=true;return result(commit(Infinity,true));}
 reset();return{update,finish,reset,getState};
}
