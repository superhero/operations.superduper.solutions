// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// Adapted reference regressions; continuous-sources.json records runtime provenance.
import {Given,When,Then} from 'quickpickle';
import {expect} from 'vitest';
import {createTranscriptMerger} from './lib/speech/continuous/transcript-merger.js';
const word=(text,start_time,end_time)=>({text,start_time,end_time});
const payload=(segmentId,start,decodedThroughSeconds,words,reason='partial',extra={})=>({segmentId,audioStartSample:Math.round(start*16000),decodedThroughSeconds,words,reason,...extra});
function apply(world,input){const before=world.merger.getState();const value=world.merger.update(input);world.fragments.push(value.stableDelta.text);world.appended.push(...value.stableDelta.words);world.outputs.push(value);world.last=value;expect(value.committedThrough).toBeGreaterThanOrEqual(before.committedThrough);expect(value.stableDelta.sequence).toBeGreaterThanOrEqual(before.sequence);return value;}
function state(world){return world.merger.getState();}
Given('a fresh global transcript merger',world=>{world.merger=createTranscriptMerger();world.fragments=[];world.appended=[];world.outputs=[];world.last={draftText:''};});
Given('two fresh transcript mergers',world=>{world.real=createTranscriptMerger();world.artificial=createTranscriptMerger();});
When('a rotation ends with the truncated word inter',world=>apply(world,payload('A',0,20,[word('We',17,17.2),word('discuss',18.2,18.5),word('inter',19.5,19.9)],'rotation')));
When('the next segment only decodes its repeated context prefix',world=>apply(world,payload('B',18,.5,[word('discuss',.2,.5)])));
When('the next segment corrects the seam to international trade',world=>apply(world,payload('B',18,2.8,[word('discuss',.2,.5),word('international',1.5,2.3),word('trade',2.4,2.7)])));
When('the corrected segment rotates',world=>apply(world,payload('B',18,22,[word('discuss',.2,.5),word('international',1.5,2.3),word('trade',2.4,2.7)],'rotation')));
Then('committed text is {string} and draft text is {string}',(world,committed,draft)=>{expect(world.fragments.join('')).toBe(committed);expect(world.last.draftText).toBe(draft);});
When('a complete word straddles the rotation cutoff',world=>apply(world,payload('A',0,20,[word('Use',18,18.2),word('continuous',18.8,19.2),word('speech',19.3,19.7)],'rotation')));
When('the next segment sees only the con prefix of that protected word',world=>apply(world,payload('B',18,.9,[word('con',.8,.9)])));
When('the next segment confirms those words at a natural pause',world=>apply(world,payload('B',18,2,[word('continuous',.8,1.2),word('speech',1.3,1.7)],'partial',{naturalPause:true})));
When('a segment finishes with decoded silence after its last word',world=>apply(world,payload('C',38,22,[word('country.',19.2,20.08)],'rotation')));
Then('word commitment ends at {float} while finalized audio ends at {int}',(world,wordEnd,audioEnd)=>{expect(state(world).committedThrough).toBeCloseTo(wordEnd,9);expect(state(world).finalizedAudioThrough).toBe(audioEnd);});
When('the next segment proposes a fresh word inside that finalized silence',world=>apply(world,payload('D',58,2.25,[word('unexpected.',.16,.32)],'partial',{naturalPause:true})));
When('the next segment corrects that word to an earlier ending',world=>apply(world,payload('B',18,2,[word('continuity',.8,.99),word('speech',1.3,1.7)],'partial',{naturalPause:true})));
When('the next segment repeats that word beyond the finalized boundary',world=>apply(world,payload('D',58,2.25,[word('country.',1.1,1.25)],'partial',{naturalPause:true})));
When('two genuine occurrences of very cross the seam',world=>{apply(world,payload('A',0,20,[word('very',18.4,18.7),word('very',19.1,19.4)],'rotation'));apply(world,payload('B',18,3,[word('very',.4,.7),word('very',1.1,1.4)],'partial',{naturalPause:true}));});
When('the sentence Go is spoken twice at different absolute times',world=>{apply(world,payload('A',0,20,[word('Go.',17,17.2),word('Go.',19.2,19.4)],'rotation'));apply(world,payload('B',18,3,[word('Go.',1.2,1.4)],'partial',{naturalPause:true}));});
When('repeated context shifts slightly into the committed time boundary',world=>{apply(world,payload('A',0,20,[word('Hello',18,18.4),word('world.',18.45,18.9),word('again',19.4,19.8)],'rotation'));apply(world,payload('B',18,3,[word('Hello',.08,.48),word('world.',.52,1.02),word('again',1.4,1.8)],'partial',{naturalPause:true}));});
When('a successor pause commits the previous segment\'s held word',world=>{apply(world,payload('A',0,20,[word('my',17.88,18.12),word('fellow',18.12,18.6),word('Americans.',18.6,19.56)],'rotation'));apply(world,payload('B',18,2.25,[word('My',.16,.24),word('fellow',.32,.56)],'partial',{naturalPause:true}));});
When('later context extends that same word\'s end by six hundred milliseconds',world=>apply(world,payload('B',18,3.5,[word('My',.16,.24),word('fellow',.32,.56),word('Americans,',.72,2.16),word('ask',2.16,2.8),word('not',2.8,3.12)],'partial',{naturalPause:true})));
When('a committed short word is repeated at a distinct nearby time',world=>{apply(world,payload('A',0,.25,[word('Go',.1,.2)],'partial',{naturalPause:true}));apply(world,payload('A',0,.5,[word('Go',.1,.2),word('go',.18,.32)],'partial',{naturalPause:true}));});
When('a late previous-segment result says something unrelated',world=>apply(world,payload('A',0,20,[word('unrelated',19,19.7)],'rotation')));
Then('the result is explicitly ignored as {string}',(world,reason)=>{expect(world.last.ignored).toBe(reason);expect(world.last.stableDelta.words).toEqual([]);});
When('the same punctuated partial arrives twice at the same horizon',world=>{const item=payload('A',0,6,[word('Hello.',1,2),word('next',4,4.5)]);apply(world,item);apply(world,item);});
When('new decoded audio confirms the sentence',world=>apply(world,payload('A',0,6.5,[word('Hello.',1,2),word('next',4,4.5),word('sentence',5,5.6)])));
When('a later hypothesis attempts to replace that committed sentence',world=>apply(world,payload('A',0,7,[word('Goodbye.',1,2),word('next',4,4.5),word('sentence',5,5.6)])));
When('one reports a natural pause and the other an artificial rotation',world=>{const item=payload('A',0,20,[word('real',18,18.3),word('pause',19.5,19.8)],'partial',{naturalPause:true});world.realOutput=world.real.update(item);world.artificialOutput=world.artificial.update({...item,reason:'rotation'});});
Then('the real pause commits all observed words',world=>{expect(world.realOutput.stableDelta.text).toBe('real pause');expect(world.realOutput.draftText).toBe('');});
Then('the artificial rotation retains the last second even if pause is incorrectly set',world=>{expect(world.artificialOutput.stableDelta.text).toBe('real');expect(world.artificialOutput.draftText).toBe('pause');});
When('the stopping segment returns its final words',world=>apply(world,payload('A',0,2,[word('still',.2,.7),word('speaking',1.1,1.9)],'stop',{naturalPause:true})));
When('all segments have drained and I finish the transcript',world=>{world.last=world.merger.finish();world.fragments.push(world.last.stableDelta.text);world.appended.push(...world.last.stableDelta.words);world.outputs.push(world.last);});
Then('finishing again appends nothing',world=>{const before=state(world);const output=world.merger.finish();expect(output.stableDelta).toEqual({words:[],text:'',sequence:before.sequence});expect(state(world).committedWordCount).toBe(before.committedWordCount);});
When('a nonempty partial is followed by an empty result',world=>{apply(world,payload('A',0,4,[word('keep',1,1.4),word('this',1.5,1.7),word('draft',1.8,2.2)]));apply(world,payload('A',0,5,[]));});
When('a segment starting at audio second 18 recognizes a local word',world=>apply(world,payload('B',18,2,[word('hello',.2,.5)],'partial',{naturalPause:true})));
Then('the committed word spans absolute seconds {float} through {float}',(world,start,end)=>{expect(world.appended).toHaveLength(1);expect(world.appended[0].start_time).toBeCloseTo(start,9);expect(world.appended[0].end_time).toBeCloseTo(end,9);});
Then('append sequence and committed time never regress',world=>{let sequence=0,time=0;for(const output of world.outputs){expect(output.stableDelta.sequence).toBeGreaterThanOrEqual(sequence);expect(output.committedThrough).toBeGreaterThanOrEqual(time);sequence=output.stableDelta.sequence;time=output.committedThrough;}});
When('two natural pauses deliver Hello comma world and then Again',world=>{apply(world,payload('A',0,2,[word('Hello',.1,.4),word(',',.4,.4),word('world.',.5,.9)],'partial',{naturalPause:true}));apply(world,payload('A',0,3,[word('Hello',.1,.4),word(',',.4,.4),word('world.',.5,.9),word('Again!',2,2.5)],'partial',{naturalPause:true}));});
When('thirty minutes of unpunctuated speech cross twenty-second cores',world=>{
 for(let index=0;index<90;index++){
  const start=Math.max(0,index*20-2),end=(index+1)*20,length=end-start;
  const horizons=[];for(let local=4;local<length;local+=4)horizons.push(local);horizons.push(length);
  for(const decoded of horizons){const words=[];for(let n=Math.floor(start);n<end;n++)if(n+.7<=start+decoded)words.push(word('w'+n,n+.1-start,n+.7-start));const reason=decoded===length?'rotation':'partial';apply(world,payload('s'+index,start,decoded,words,reason));}
 }
 world.last=world.merger.finish();world.fragments.push(world.last.stableDelta.text);world.appended.push(...world.last.stableDelta.words);world.outputs.push(world.last);
});
Then('all {int} words appear once and in source order',(world,count)=>{expect(world.appended).toHaveLength(count);expect(world.appended.map(w=>w.text)).toEqual(Array.from({length:count},(_,i)=>'w'+i));expect(world.fragments.join('').split(' ')).toHaveLength(count);expect(state(world).committedWordCount).toBe(count);});
Then('retained words never exceed {int} including at most {int} committed context words',(world,total,tail)=>{expect(state(world).peakRetainedWordCount).toBeLessThanOrEqual(total);expect(state(world).committedTailWordCount).toBeLessThanOrEqual(tail);expect(state(world).provisionalWordCount).toBe(0);});
When('I reset and start a new recording',world=>{world.merger.reset();world.fragments=[];world.appended=[];world.outputs=[];apply(world,payload('A',0,1,[word('new',.1,.5)],'partial',{naturalPause:true}));});
Then('the new recording starts with append sequence {int}',(world,sequence)=>{expect(world.last.stableDelta.sequence).toBe(sequence);expect(world.appended[0].start_time).toBe(.1);});
When('the merger receives invalid {string} evidence',(world,kind)=>{const raw=kind==='already global timestamps'?word('bad',18.2,18.5):kind==='nonfinite timestamp'?word('bad',NaN,1):word('bad',1,.5);try{world.merger.update(payload('B',18,2,[raw]));world.rejection=null;}catch(error){world.rejection=error;}});
Then('the merger rejects that evidence',world=>expect(world.rejection).toBeInstanceOf(Error));
