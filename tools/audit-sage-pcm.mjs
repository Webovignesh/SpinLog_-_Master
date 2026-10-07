// Verify the real AudioWorklet processor across render blocks and sample rates.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createSpeechDetector} from '../vendor/sage-vad.js';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/js/sage-pcm-worklet.js',import.meta.url),'utf8').then(s=>s.replace(/^import .*;$/m,''));
for(const rate of [16000,44100,48000]) {
  test(`PCM worklet preserves onset, duration and packet continuity at ${rate} Hz`,()=>{
    const packets=[];let Ctor;
    class Processor {port={postMessage:m=>packets.push(m)};}
    vm.runInNewContext(source,{AudioWorkletProcessor:Processor,sampleRate:rate,Int16Array,
      createSpeechDetector,registerProcessor:(_name,value)=>{Ctor=value;}});
    const p=new Ctor(),duration=.537,input=new Float32Array(Math.round(rate*duration));
    for(let i=0;i<input.length;i++)input[i]=.2*Math.sin(2*Math.PI*220*i/rate);
    // A short first word begins in the very first render block.
    input[0]=.5;
    for(let i=0;i<input.length;i+=128)p.process([[input.subarray(i,i+128)]]);
    p.port.onmessage({data:'flush'});
    const audio=packets.filter(m=>m.pcm),samples=audio.flatMap(m=>Array.from(new Int16Array(m.pcm)));
    assert.ok(Math.abs(samples.length-input.length*16000/rate)<1);
    assert.ok(samples[0]>1000,'the first sample is retained');
    assert.ok(audio.slice(0,-1).every(m=>m.pcm.byteLength===3200),'100 ms packets');
    let error=0;
    for(let i=1;i<samples.length;i++)error+=Math.abs(samples[i]/32768-.2*Math.sin(2*Math.PI*220*(i+.5)/16000));
    assert.ok(error/samples.length<.009,'no dropped/repeated samples or frame-boundary clicks');
    assert.equal(packets.at(-1).flushed,true);
  });
}

const fixture=JSON.parse(await readFile(new URL('fixtures/sage-english-speech.json',import.meta.url),'utf8'));
const fixtureBytes=Buffer.from(fixture.pcm,'base64');
const utterance=new Int16Array(fixtureBytes.buffer.slice(fixtureBytes.byteOffset,fixtureBytes.byteOffset+fixtureBytes.length));
// Run the production full-recording validator with its real WASM detector.
// VM dynamic import alone is substituted to avoid Node's experimental VM flag.
const earsSource=await readFile(new URL('../src/js/sage-transcription.js',import.meta.url),'utf8');
test('offline cache contains the exact worklet and transitive speech-detector URLs',async()=>{
  const worker=await readFile(new URL('../service-worker.js',import.meta.url),'utf8');
  const rawWorklet=await readFile(new URL('../src/js/sage-pcm-worklet.js',import.meta.url),'utf8');
  const cache=vm.runInNewContext(worker.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1],{OFFLINE_URL:'index.html'});
  const base='https://spinlog.test/src/js/sage-transcription.js';
  const resolve=(value,from=base)=>{const url=new URL(value,from);return '.'+url.pathname+url.search;};
  const worklet=earsSource.match(/new URL\('(sage-pcm-worklet[^']+)'/)[1];
  const detector=earsSource.match(/new URL\('([^']+sage-vad[^']+)'/)[1];
  const dependency=rawWorklet.match(/^import .* from '([^']+)'/m)[1];
  assert.ok(cache.includes(resolve(worklet)),'capture module is available offline');
  assert.ok(cache.includes(resolve(detector)),'full-recording detector is available offline');
  assert.ok(cache.includes(resolve(dependency,new URL(worklet,base))),'worklet detector import survives an old-cache purge');
  assert.equal(resolve(dependency,new URL(worklet,base)),resolve(detector),'both recognition paths use the same detector release');
});
const ears={document:{},self:null,createSpeechDetector,DataView,Int16Array};ears.self=ears;
vm.runInNewContext(earsSource.replace('import(detectorURL)','Promise.resolve({createSpeechDetector:root.createSpeechDetector})'),ears);
function wav(pcm) {
  const bytes=Buffer.alloc(44+pcm.length*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);
  bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);
  bytes.write('data',36);bytes.writeUInt32LE(pcm.length*2,40);pcm.forEach((n,i)=>bytes.writeInt16LE(n,44+i*2));
  return new Blob([bytes],{type:'audio/wav'});
}
for(const scale of [1,.15])test(`complete recorder validation retains a cold-start first word at amplitude ${scale}`,async()=>{
  const prefix=Int16Array.from(utterance.subarray(0,9600),n=>n*scale),full=new Int16Array(32000);
  full.set(prefix,1600); // word precedes late worklet attachment; trailing audio is silent
  assert.equal(await ears.SageTranscription.hasSpeech(wav(full)),true);
});
function classify(pcm) {
  const packets=[];let Ctor;
  class Processor {port={postMessage:m=>packets.push(m)};}
  vm.runInNewContext(source,{AudioWorkletProcessor:Processor,sampleRate:16000,Int16Array,createSpeechDetector,
    registerProcessor:(_name,value)=>{Ctor=value;}});
  const p=new Ctor();
  const input=Float32Array.from(pcm,n=>n/32768);
  for(let i=0;i<input.length;i+=128)p.process([[input.subarray(i,i+128)]]);
  p.port.onmessage({data:'flush'});p.port.onmessage({data:'close'});
  return packets.filter(m=>m.pcm);
}
for(const scale of [1,.15])test(`bundled WebRTC VAD detects English speech at amplitude ${scale} with a first-word prefix`,()=>{
  const packets=classify(Int16Array.from(utterance,n=>n*scale));
  assert.ok(packets.reduce((n,p)=>n+p.speechMs,0)>700,'real speech is recognized, including soft speech');
  let run=0;const first=packets.findIndex(p=>{run=p.speechMs?run+p.speechMs:0;return run>=120;});
  assert.ok(first>=0&&first<5,'first speech is detected within 500ms, without another utterance');
  assert.ok(packets.every(p=>p.speechMs<=100&&p.activeMs<=100),'classification uses 20ms windows, not whole-buffer loudness');
});
for(const name of ['silence','fan','click','dc'])test(`startup ${name} never reaches the 120ms speech gate or passes complete recorder validation`,async()=>{
  const samples=new Int16Array(16000);let seed=11;
  for(let i=0;i<samples.length;i++){
    seed=(seed*1664525+1013904223)>>>0;
    if(name==='fan')samples[i]=(Math.sin(2*Math.PI*100*i/16000)*.016+(seed/4294967296-.5)*.009)*32767;
    if(name==='click'&&i<160)samples[i]=(i%2?.3:-.3)*32767;
    if(name==='dc')samples[i]=1400;
  }
  let run=0,max=0;
  for(const packet of classify(samples)){run=packet.speechMs?run+Math.min(packet.speechMs,packet.activeMs):0;max=Math.max(max,run);}
  assert.ok(max<120,`${name} was rejected (max ${max}ms)`);
  assert.equal(await ears.SageTranscription.hasSpeech(wav(samples)),false);
});

for(const frequency of [100,440,997,2200])test(`steady ${frequency}Hz background tone cannot start a voice turn`,async()=>{
  const pcm=Int16Array.from({length:32000},(_,i)=>Math.sin(2*Math.PI*frequency*i/16000)*6000);
  let run=0,max=0;
  for(const packet of classify(pcm)){run=packet.speechMs?run+packet.speechMs:0;max=Math.max(max,run);}
  assert.ok(max<120,`tone was rejected before a turn (${max}ms)`);
  assert.equal(await ears.SageTranscription.hasSpeech(wav(pcm)),false);
});
test('quiet real speech survives after a learned fan floor, including its first word',async()=>{
  const pcm=new Int16Array(16000+utterance.length);
  let seed=37;
  for(let i=0;i<pcm.length;i++){
    seed=(seed*1664525+1013904223)>>>0;
    pcm[i]=(Math.sin(2*Math.PI*100*i/16000)*.002+(seed/4294967296-.5)*.002)*32767;
    if(i>=16000)pcm[i]+=utterance[i-16000]*.15;
  }
  const packets=classify(pcm);
  assert.ok(packets.slice(10).reduce((n,p)=>n+p.speechMs,0)>500);
  assert.equal(await ears.SageTranscription.hasSpeech(wav(pcm)),true);
});
