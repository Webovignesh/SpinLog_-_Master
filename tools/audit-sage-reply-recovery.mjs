// Focused lifecycle regressions with synthetic PCM and provider responses.
// Reuse the existing isolated harness without running or rewriting its tests.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const files=await Promise.all(['../src/js/sage-voice.js','../src/js/sage-transcription.js','../src/js/sage-tools.js','../index.html','./audit-sage-voice.mjs'].map(f=>readFile(new URL(f,import.meta.url),'utf8')));
const [source,liveSource,toolsSource,html,existing]=files;
const start=existing.indexOf('function harness(options = {}) {'),end=existing.indexOf("\ntest('cold-load",start);
assert.ok(start>=0&&end>start,'the isolated voice harness is available');
const speechPCM=Buffer.alloc(4800);
for(let i=0;i<2400;i++)speechPCM.writeInt16LE(Math.round(Math.sin(i/6)*5000),i*2);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<200;i++){if(check())return;await delay(10);}assert.ok(check(),'voice state timed out');}
const harness=new Function('vm','source','liveSource','toolsSource','html','speechPCM','until','Buffer',existing.slice(start,end)+';return harness;')(vm,source,liveSource,toolsSource,html,speechPCM,until,Buffer);
const count=h=>h.root.SageVoice.diagnostics().events.filter(e=>e.event==='spoken-interruption').length;
async function pendingReply(h) {
  let answer;h.root.SageAI.askSage=()=>new Promise(resolve=>answer=resolve);
  await h.open();await until(()=>h.worklets.length===1);h.worklets[0].frame(0);
  const reply=h.root.SageVoice.sendVoiceText('Hello');await until(()=>h.worklets.length===2);
  return {reply,monitor:h.worklets[1],answer:()=>answer({ok:true,text:'Hello. I am here.'})};
}
test('ongoing microphone speech after submission cannot silently cancel the first answer',async()=>{
  const h=harness({live:true,holdPlayback:true});
  try {
    const {reply,monitor,answer}=await pendingReply(h);
    for(let i=0;i<5;i++){monitor.frame();h.tick(100);}
    assert.equal(count(h),0,'interruption requires a fresh quiet-to-speech transition');
    answer();await until(()=>h.playback.length===1);
    assert.equal(h.root.SageVoice.diagnostics().recording,false);
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Replying…');
    h.playback[0].end();await reply;
    assert.equal(h.root.SageVoice.diagnostics().open,true);
  }finally{h.cleanup();}
});
test('partial speech classifications and isolated noise bursts do not cancel a pending answer',async()=>{
  const h=harness({live:true,holdPlayback:true});
  try {
    const {reply,monitor,answer}=await pendingReply(h);
    monitor.frame(0);monitor.frame(0);
    for(let i=0;i<6;i++)monitor.frame(.08,undefined,{speechMs:40,activeMs:140});
    assert.equal(count(h),0,'a minority of speech-classified samples is not sustained speech');
    answer();await until(()=>h.playback.length===1);h.playback[0].end();await reply;
  }finally{h.cleanup();}
});
test('fresh sustained speech can still interrupt a pending answer and retain the first words',async()=>{
  const h=harness({live:true,holdPlayback:true});
  try {
    const {reply,monitor,answer}=await pendingReply(h);
    monitor.frame(0);monitor.frame(0);
    for(let i=0;i<3;i++)monitor.frame();
    await until(()=>count(h)===1);
    assert.equal(h.root.SageVoice.diagnostics().recording,true);
    answer();await reply;assert.equal(h.playback.length,0,'the old answer stays cancelled');
    assert.equal(h.streams.length,1,'the existing mic is transferred');
  }finally{h.cleanup();}
});
test('natural syllable gaps do not force the user to repeat an interruption',async()=>{
  const h=harness({live:true,holdPlayback:true});
  try {
    const {reply,monitor,answer}=await pendingReply(h);
    monitor.frame(0);monitor.frame(0);
    monitor.frame(.08,undefined,{speechMs:140,activeMs:140});
    monitor.frame(.08,undefined,{speechMs:80,activeMs:80});
    await until(()=>count(h)===1);
    answer();await reply;assert.equal(h.playback.length,0);
  }finally{h.cleanup();}
});
test('an audible reply retains the speaking state until every queued source finishes',async()=>{
  const h=harness({live:true,holdPlayback:true,askSage:async()=>({ok:true,text:'This is a sample answer.'})});
  try {
    await h.open();await until(()=>h.worklets.length===1);h.worklets[0].frame(0);
    const reply=h.root.SageVoice.sendVoiceText('Explain the sample');await until(()=>h.playback.length===1);
    const monitor=h.worklets.at(-1);for(let i=0;i<5;i++)monitor.frame(0);
    assert.equal(h.root.SageVoice.diagnostics().mode,'speaking');assert.equal(h.root.SageVoice.diagnostics().recording,false);
    await delay(100);assert.equal(h.root.SageVoice.diagnostics().mode,'speaking');
    h.playback[0].end();await reply;h.worklets.at(-1).frame(0);
    assert.equal(h.root.SageVoice.diagnostics().mode,'listening');
  }finally{h.cleanup();}
});
test('fresh deliberate speech interrupts actual playback after a quiet baseline',async()=>{
  const h=harness({live:true,holdPlayback:true,askSage:async()=>({ok:true,text:'This is a sample answer.'})});
  try {
    await h.open();await until(()=>h.worklets.length===1);h.worklets[0].frame(0);
    const reply=h.root.SageVoice.sendVoiceText('Explain the sample');await until(()=>h.playback.length===1&&h.worklets.length===2);
    const monitor=h.worklets[1];monitor.frame(0);monitor.frame(0);for(let i=0;i<3;i++)monitor.frame();
    await until(()=>count(h)===1);await reply;
    assert.equal(h.playback[0].stopped,true);assert.equal(h.root.SageVoice.diagnostics().recording,true);
  }finally{h.cleanup();}
});
