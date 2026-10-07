// Deterministic voice lifecycle regressions. No API keys, network or database.
// Run: node --test tools/audit-sage-voice.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const speechPCM = Buffer.alloc(4800);
for (let i=0;i<2400;i++) speechPCM.writeInt16LE(Math.round(Math.sin(i / 6) * 5000), i*2);
const source = await readFile(new URL('../src/js/sage-voice.js', import.meta.url), 'utf8');
const liveSource = await readFile(new URL('../src/js/sage-transcription.js', import.meta.url), 'utf8');
const toolsSource = await readFile(new URL('../src/js/sage-tools.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 150; i++) { if (check()) return; await delay(10); }
  assert.ok(check(), 'timed out waiting for voice state');
}

test('natural breathing window owns cutoff and four turns follow the complete loop without idle flashes',async()=>{
  const h=harness({live:true,holdPlayback:true,storage:{sage_voice_pause:null},liveEnd:ws=>ws.message({serverContent:{turnComplete:true}})});
  try {
    h.phases.length=0;await h.open();await until(()=>h.worklets.length===1);
    for(let turn=0;turn<4;turn++) {
      const mic=h.worklets.at(-1),recorder=h.recordings.at(-1);
      mic.frame(0);await until(()=>h.nodes.get('sageVoiceState').textContent==='Listening…');
      mic.frame();h.tick(100);
      h.sockets[0].message({serverContent:{inputTranscription:{text:`Turn ${turn}`},generationComplete:true}});
      await delay(220);
      assert.equal(recorder.state,'recording','server final cannot cut off local speech');
      mic.frame(0);h.tick(100);h.tick(700);
      assert.equal(h.asks.length,turn,'a short sentence pause is breathing room');
      mic.frame();h.tick(100); // speech resumes, so the pause starts again
      mic.frame(0);h.tick(100);h.tick(899);
      assert.equal(recorder.state,'recording');h.tick(1);
      await until(()=>h.playback.length===turn+1);
      assert.equal(recorder.state,'inactive');assert.equal(h.recordings.length,turn+1,'mic stays off throughout playback');
      assert.equal(h.nodes.get('sageVoiceState').textContent,'Replying…');
      h.playback.at(-1).end();await until(()=>h.worklets.length===turn+2);
      h.worklets.at(-1).frame(0);await until(()=>h.nodes.get('sageVoiceState').textContent==='Listening…');
    }
    const phases=h.phases.filter((phase,i)=>phase!==h.phases[i-1]);
    assert.deepEqual(phases,['Connecting…','Listening…',...Array.from({length:4},()=>['Processing…','Replying…','Connecting…','Listening…']).flat()]);
    assert.equal(h.asks.length,4);assert.equal(h.streams.length,1);
  } finally {h.cleanup();}
});

test('native recognition disconnect cannot bypass the local breathing pause',async()=>{
  const h=harness({live:true,noKey:true,storage:{sage_voice_pause:null}});
  try {h.root.SageAI.getKeys=()=>[{id:'test',key:'configured-but-resting'}];
    await h.open();await until(()=>h.worklets.length===1&&h.recognition.length===1);
    h.worklets[0].frame();h.recognition[0].result('Tell me about my bike');h.recognition[0].onend();
    await delay(40);assert.equal(h.recordings[0].state,'recording');assert.equal(h.asks.length,0);
    h.worklets[0].frame(0);h.tick(100);h.tick(899);assert.equal(h.asks.length,0);
    h.tick(1);await until(()=>h.asks.length===1);assert.equal(h.recordings[0].state,'inactive');
  }finally{h.cleanup();}
});
test('native reconnect preserves a sentence resumed within the breathing window',async()=>{
  const h=harness({live:true,noKey:true,storage:{sage_voice_pause:null}});
  try {h.root.SageAI.getKeys=()=>[{id:'test',key:'configured-but-resting'}];
    await h.open();await until(()=>h.worklets.length===1&&h.recognition.length===1);
    const mic=h.worklets[0],native=h.recognition[0];
    mic.frame();native.result('Tell me about');native.onend();mic.frame(0);h.tick(100);h.tick(300);
    await until(()=>native.starts===2);assert.equal(h.asks.length,0);
    mic.frame();h.tick(100);native.result('my exhaust');
    assert.match(h.nodes.get('sageVoiceCaption').innerHTML,/Tell me about my exhaust/);
    mic.frame(0);h.tick(100);h.tick(900);await until(()=>h.asks.length===1);
    assert.deepEqual(h.asks,['Tell me about my exhaust']);
  }finally{h.cleanup();}
});
function harness(options = {}) {
  const timers = new Set(), intervals = new Map(), nodes = new Map(), streams = [], recordings = [], recognition = [];
  const asks = [], requests = [], decoded = [], playback = [], contexts = [];
  const sockets = [], worklets = [], analysers = [], animationFrames = new Map();
  let history = [], now = 100000; const phases=[];
  class Element {
    constructor(id = '') { this.id = id; this.children = []; this.events = {}; this.attrs = {}; this.hidden = false; this.value = ''; this.type = ''; this.isConnected = true; this.style = { setProperty(k,v) { this[k]=v; }, removeProperty(k) { delete this[k]; } }; this.classList = { add() {}, remove() {}, toggle() {} }; }
    set textContent(value) {this.text=String(value);if(this.id==='sageVoiceState')phases.push(this.text);}
    get textContent() {return this.text || '';}
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
    emit(name,extra={}) { this.events[name]?.forEach(fn => fn({ preventDefault() {}, stopPropagation() {}, target: this,currentTarget:this,...extra })); }
    setAttribute(k,v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k]; }
    set innerHTML(v) { this.html = v; this.children = []; }
    get innerHTML() { return this.html || ''; }
    get firstChild() { return this.children[0]; }
    appendChild(child) { child.parent = this; this.children.push(child); }
    remove() { this.isConnected = false; if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this),1); }
    focus() { document.activeElement = this; }
    getBoundingClientRect() { return { top: (this.parent?.children.indexOf(this) || 0) * 50 }; }
    querySelectorAll() { return []; }
    contains(el) { return el === this || el.parent === this; }
  }
  for (const m of html.matchAll(/id="([^"]+)"/g)) nodes.set(m[1], new Element(m[1]));
  const document = { readyState: 'complete', activeElement: nodes.get('sageChatMic'), hidden: false,
    getElementById: id => nodes.get(id) || null, createElement: () => new Element(),
    events: {}, addEventListener(name,fn) { (this.events[name] ||= []).push(fn); } };
  const track = () => ({ readyState: 'live', enabled: true, stop() { this.readyState = 'ended'; } });
  const newStream = () => { const t = track(); const stream = { getTracks: () => [t] }; streams.push(stream); return stream; };
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm;codecs=opus'; recordings.push(this); }
    start() { this.state = 'recording'; this.onstart?.(); this.ondataavailable?.({ data: new Blob(['first-']) }); }
    stop() { this.state = 'inactive'; setTimeout(() => { this.ondataavailable?.({ data: new Blob(['LAST']) }); if(!options.noStopEvent)this.onstop?.(); }, 0); }
  }
  class Recognition {
    constructor() { recognition.push(this); }
    start() { this.starts=(this.starts||0)+1; if(!options.hangNative)this.onstart?.(); }
    abort() { this.onend?.(); }
    stop() { this.onend?.(); }
    result(text, final = true, confidence = 0.9) {
      const item = [{ transcript: text, confidence }]; item.isFinal = final;
      this.onresult?.({ resultIndex: 0, results: [item] });
    }
  }
  class AudioContext {
    currentTime = 0;
    constructor() { contexts.push(this); }
    state = options.audioBlocked ? 'suspended' : 'running';
    audioWorklet = {addModule:options.addModule || (async()=>{})};
    destination = {};
    resume() { return Promise.resolve(); }
    createBuffer(channels,length,rate) { return {duration:length/rate,copyToChannel(data) { this.samples = new Float32Array(data); }}; }
    createBufferSource() {
      const source = {playbackRate:{value:1},connect(){},disconnect(){},
        start(when=0){source.startAt=when;playback.push(source); if (!options.holdPlayback) setTimeout(()=>source.onended?.(),5);},
        stop(){source.stopped=true;}, end(){source.onended?.();}};
      return source;
    }
    close() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { const analyser={ fftSize:1024, sample:null,connect(){},disconnect(){this.disconnected=true;},getByteTimeDomainData(data) { data.fill(this.sample ?? (options.loud ? 136 : 128)); } };analysers.push(analyser);return analyser; }
    async decodeAudioData(buffer) { decoded.push(Buffer.from(buffer).toString()); if(options.hangDecode)return new Promise(()=>{}); return { duration: 0.1 }; }
  }
  class OfflineAudioContext {
    createBufferSource() { return { connect() {}, start() {} }; }
    startRendering() { return Promise.resolve({ getChannelData: () => new Float32Array(1600) }); }
  }
  class Audio {
    play() { setTimeout(() => this.onended?.(), 0); return Promise.resolve(); }
    pause() {} removeAttribute() {}
  }
  class FileReader {
    readAsDataURL(blob) { blob.arrayBuffer().then(buffer => { this.result = 'data:audio/wav;base64,' + Buffer.from(buffer).toString('base64'); this.onload?.(); }); }
  }
  class Socket {
    readyState = 0; sent = [];
    constructor() { sockets.push(this); setTimeout(()=>{this.readyState=1;this.onopen?.();},0); }
    send(raw) {
      const value=JSON.parse(raw); this.sent.push(value);
      if (value.setup && options.autoSetup !== false) this.message({setupComplete:{}});
      if (value.realtimeInput?.audioStreamEnd && options.liveEnd) options.liveEnd(this);
    }
    message(value) { this.onmessage?.({data:JSON.stringify(value)}); }
    close() { this.readyState = 3; }
  }
  class Worklet {
    constructor() { worklets.push(this);this.port={onmessage:null,postMessage:()=>{if(!options.noPCMFlush)this.port.onmessage?.({data:{flushed:true}});}}; }
    connect() {} disconnect() {this.disconnected=true;if(options.throwWorkletStop)throw new Error('capture node already closed');}
    frame(rms=0.08,pcm=speechPCM.buffer.slice(speechPCM.byteOffset,speechPCM.byteOffset+speechPCM.byteLength),
      vad={speechMs:rms>0?140:0,activeMs:rms>0?140:0}) {this.lastFrame={rms,pcm,...vad};this.port.onmessage?.({data:this.lastFrame});}
  }
  const storage = new Map(Object.entries({sage_voice_pause:'quick',...options.storage}));
  const root = { document, navigator: { onLine: true, mediaDevices: { getUserMedia: options.getUserMedia || (async () => newStream()) } },
    SpeechRecognition: Recognition, MediaRecorder: Recorder, AudioContext, OfflineAudioContext, Audio, FileReader,
    Blob, DataView, ArrayBuffer, Uint8Array, Float32Array, AbortController, TextDecoder, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    atob: b64 => Buffer.from(b64, 'base64').toString('binary'),
    btoa: binary => Buffer.from(binary,'binary').toString('base64'),
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) },
    setTimeout(fn,ms) { const timer = setTimeout(fn,options.fastTimeouts && ms >= 1000 ? 30 : options.fastRestarts && ms >= 500 && ms <= 3000 ? 0 : ms); timers.add(timer); return timer; }, clearTimeout,
    setInterval(fn) { const id = Symbol(); intervals.set(id,fn); return id; }, clearInterval: id => intervals.delete(id),
    requestAnimationFrame: fn => { const id=Symbol();animationFrames.set(id,fn);return id; }, cancelAnimationFrame:id=>animationFrames.delete(id), matchMedia: () => ({ matches: true }),
    Date: class extends Date { static now() { return now; } },
    dkReduceMotion: () => true,
    dkCloudStore: { chatHistory: () => history.slice(), setChat: rows => { history = rows; } },
    SageAI: { availableKeys: () => options.noKey ? [] : [{ key: 'test-only' }], askSage: options.askSage || (async text => { asks.push(text); return { ok: true, text: 'Okay, let’s check your service history.' }; }) },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body); requests.push({url,body,signal:init.signal});
      if (body.generationConfig.responseModalities) return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: options.emptyAudio ? 'AAAAAA==' : (options.silentAudio ? Buffer.alloc(speechPCM.length) : speechPCM).toString('base64'), mimeType:'audio/L16;rate=24000' } }] } }] }) };
      if (options.transcribe) return options.transcribe(init);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(options.transcript || { transcript: 'நேத்து petrol போட்டேன் bro', unclear: false }) }] } }] }) };
    }, console,
  };
  root.self = root;
  if (options.live) {root.WebSocket=Socket;root.AudioWorkletNode=Worklet;vm.runInNewContext(liveSource,root,{filename:'sage-transcription.js'});}
  // Lifecycle mocks classify the decoded recording separately. The real
  // bundled detector is exercised by audit-sage-pcm and Chromium tests.
  if(root.SageTranscription)root.SageTranscription.hasSpeech=async blob=>{
    options.checkedRecordings?.push(blob);return options.recordedSpeech!==false;
  };
  vm.runInNewContext(toolsSource, root, { filename:'sage-tools.js' });
  vm.runInNewContext(source, root, { filename: 'sage-voice.js' });
  return { root, nodes, streams, recordings, recognition, asks, requests, decoded, storage, playback, contexts,sockets,worklets,analysers,animationFrames,phases,
    get history() { return history; },
    tick(ms) { now += ms;
      // A running worklet emits packets during silence too. Advancing the
      // endpoint clock should not accidentally simulate a capture failure.
      const node=worklets.at(-1);
      if(!options.stallPCM && ms>250 && node?.lastFrame && (node.lastFrame.rms===0 || node.lastFrame.speechMs===0) && !node.disconnected)node.port.onmessage?.({data:node.lastFrame});
      [...intervals.values()].forEach(fn => fn()); },
    animate() { const frames=[...animationFrames.values()];animationFrames.clear();frames.forEach(fn=>fn()); },
    async open() { root.SageVoice.open(); await until(() => recordings.length || (options.storage?.sage_voice_recognition === 'browser' && recognition.length)); },
    async finish() { nodes.get('sageVoiceOrb').emit('click'); await until(() => requests.some(r => !r.body.generationConfig.responseModalities)); },
    cleanup() { root.SageVoice.close(); timers.forEach(clearTimeout); }, newStream,
  };
}

test('cold-load mic noise cannot auto-process before the detector or upload silence',async()=>{
  let ready;const checked=[];
  const h=harness({live:true,loud:true,recordedSpeech:false,checkedRecordings:checked,
    addModule:()=>new Promise(resolve=>{ready=resolve;})});
  try{
    await h.open();h.tick(100);h.tick(150);h.analysers[0].sample=128;h.tick(100);h.tick(650);
    await delay(30);
    assert.equal(h.recordings[0].state,'recording','wait for classification, not a meter-only endpoint');
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Connecting…');
    assert.equal(h.requests.length,0);
    ready();await until(()=>h.worklets.length===1);
    h.worklets[0].frame(0,undefined,{speechMs:0,activeMs:0});h.tick(100);h.tick(650);
    await until(()=>h.recordings.length===2);
    assert.equal(checked.length,1,'check complete prefix audio locally');
    assert.equal(h.requests.length,0);assert.equal(h.history.length,0);assert.equal(h.asks.length,0);
    assert.notEqual(h.nodes.get('sageVoiceState').textContent,'Processing');
  }finally{h.cleanup();}
});

test('a real first word ending before a cold detector starts is kept once',async()=>{
  let ready;const checked=[];
  const h=harness({live:true,loud:true,checkedRecordings:checked,addModule:()=>new Promise(resolve=>{ready=resolve;})});
  try{
    await h.open();h.tick(100);h.tick(150);h.analysers[0].sample=128;h.tick(100);h.tick(650);
    ready();await until(()=>h.worklets.length===1);
    h.worklets[0].frame(0,undefined,{speechMs:0,activeMs:0});h.tick(100);h.tick(650);
    await until(()=>h.recordings.length===2);
    assert.equal(checked.length,1);assert.equal(h.decoded[0],'first-LAST');
    assert.equal(h.asks.length,1);assert.equal(h.playback.length,1);
  }finally{h.cleanup();}
});

test('a broken speech stream recovers with one complete request using the same speaker',async()=>{
  const h=harness();const routes=[],bodies=[];
  try{
    await h.open();h.root.fetch=async(url,init)=>{
      routes.push(url);bodies.push(JSON.parse(init.body));
      if(url.includes(':streamGenerateContent'))throw new TypeError('stream disconnected');
      return {ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:'audio/L16;rate=24000',data:speechPCM.toString('base64')}}]}}]})};
    };
    await h.root.SageVoice.sendVoiceText('hello');
    assert.equal(h.playback.length,1,'a transient stream fault does not silently leave text only');
    assert.equal(routes.length,2);assert.match(routes[1],/:generateContent$/);
    assert.deepEqual(bodies[1],bodies[0]);assert.equal(h.history.length,2);assert.equal(h.recordings.length,2);
  }finally{h.cleanup();}
});

test('complete WAV speech is decoded as audio, never as RIFF-header noise',async()=>{
  const h=harness();const wav=Buffer.alloc(44+speechPCM.length);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
  wav.write('data',36);wav.writeUInt32LE(speechPCM.length,40);speechPCM.copy(wav,44);
  try{
    await h.open();h.root.fetch=async()=>({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{inlineData:{mimeType:'audio/wav',data:wav.toString('base64')}}]}}]})});
    await h.root.SageVoice.sendVoiceText('hello');
    assert.equal(h.playback.length,1);assert.equal(h.playback[0].buffer.samples.length,speechPCM.length/2);
    assert.equal(h.playback[0].buffer.samples[0],0);
  }finally{h.cleanup();}
});

test('audio failure remains visible when next-turn PCM readiness arrives',async()=>{
  const h=harness({live:true,silentAudio:true});
  try{
    await h.open();await h.root.SageVoice.sendVoiceText('hello');await until(()=>h.worklets.length===2);
    h.worklets[1].frame(0,undefined,{speechMs:0,activeMs:0});
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Listening…');
    assert.match(h.nodes.get('sageVoiceHint').textContent,/Audio is unavailable/);
  }finally{h.cleanup();}
});

test('output resume can take longer than 350ms without dropping the spoken reply',async()=>{
  const h=harness();
  try{
    await h.open();const ctx=h.contexts[0];ctx.state='suspended';
    ctx.resume=()=>new Promise(resolve=>setTimeout(()=>{ctx.state='running';resolve();},450));
    await h.root.SageVoice.sendVoiceText('hello');
    assert.equal(h.playback.length,1);assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),'false');
  }finally{h.cleanup();}
});

test('startup meter activity cannot authorize unsolicited Live words before classification',async()=>{
  let ready;const h=harness({live:true,loud:true,recordedSpeech:false,addModule:()=>new Promise(resolve=>{ready=resolve;})});
  try{
    await h.open();await until(()=>h.sockets[0].sent.length);h.tick(100);h.tick(150);
    h.sockets[0].message({serverContent:{inputTranscription:{text:'Hello'},turnComplete:true}});
    await delay(200);assert.equal(h.nodes.get('sageVoiceCaption').innerHTML.includes('Hello'),false);
    assert.equal(h.asks.length,0);assert.equal(h.requests.length,0);
    ready();await until(()=>h.worklets.length===1);
  }finally{h.cleanup();}
});
test('an unavailable streaming classifier uses verified full audio rather than unclassified Live captions',async()=>{
  const h=harness({live:true,recordedSpeech:false});
  try{
    await h.open();await until(()=>h.worklets.length===1&&h.sockets[0].sent.length);
    h.worklets[0].frame(.04,undefined,{speechMs:null,activeMs:100});h.tick(100);
    h.worklets[0].frame(0,undefined,{speechMs:null,activeMs:0});h.tick(100);h.tick(650);
    await until(()=>h.recordings.length===2);
    assert.equal(h.sockets[0].sent.some(m=>m.realtimeInput?.audio),false);
    assert.equal(h.requests.length,0);assert.equal(h.asks.length,0);
  }finally{h.cleanup();}
});
test('a source that failed to start is repaired once instead of falsely marking audio as played',async()=>{
  const h=harness();
  try{
    await h.open();const ctx=h.contexts[0],create=ctx.createBufferSource.bind(ctx);let first=true;
    ctx.createBufferSource=()=>{
      const source=create();if(first){first=false;source.start=()=>{throw new Error('output device was changing');};}return source;
    };
    await h.root.SageVoice.sendVoiceText('hello');
    assert.equal(h.playback.length,1);assert.equal(h.requests.length,2);assert.match(h.requests[1].url,/:generateContent$/);
    assert.equal(h.recordings.length,2);
  }finally{h.cleanup();}
});
test('an output context interrupted during synthesis resumes before playback without another request',async()=>{
  const h=harness();
  try{
    await h.open();const ctx=h.contexts[0],fetch=h.root.fetch;
    ctx.resume=async()=>{ctx.state='running';};
    h.root.fetch=async(...args)=>{const response=await fetch(...args);ctx.state='suspended';return response;};
    await h.root.SageVoice.sendVoiceText('hello');
    assert.equal(h.playback.length,1);assert.equal(h.requests.length,1);assert.equal(h.recordings.length,2);
  }finally{h.cleanup();}
});

test('audio-first captures the final chunk, sends PCM WAV, stores both turns and resumes', async () => {
  const h = harness();
  try {
    await h.open();
    assert.equal(h.recognition.length, 0);
    await h.finish();
    await until(() => h.recordings.length === 2);
    assert.equal(h.decoded[0], 'first-LAST');
    const stt = h.requests.find(r => !r.body.generationConfig.responseModalities).body;
    assert.equal(stt.contents[0].parts[0].inlineData.mimeType, 'audio/wav');
    const wav = Buffer.from(stt.contents[0].parts[0].inlineData.data, 'base64');
    assert.equal(wav.toString('ascii',0,4), 'RIFF');
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.deepEqual(h.asks, ['நேத்து petrol போட்டேன் bro']);
    assert.equal(h.history.length, 2);
    assert.equal(h.nodes.get('sageVoiceLines').children.length, 2);
  } finally { h.cleanup(); }
});

test('unclear speech gets a spoken clarification, no form, and resumes without a guessed action', async () => {
  const h = harness({ transcript: { transcript: '5000 petrol', unclear: true } });
  try {
    await h.open(); await h.finish(); await until(()=>h.recordings.length===2);
    assert.equal(h.asks.length,0); assert.equal(h.nodes.has('sageVoiceReview'),false);
    assert.equal(h.playback.length,1); assert.equal(h.root.SageVoice.isOpen(),true);
    assert.match(h.nodes.get('sageVoiceLines').children.at(-1).innerHTML,/say it once more/);
  } finally { h.cleanup(); }
});

test('latest four turns remain; full conversation stays in history', async () => {
  const h = harness();
  try {
    await h.open();
    for (let i=0;i<3;i++) await h.root.SageVoice.sendVoiceText('turn ' + i);
    const lines = h.nodes.get('sageVoiceLines').children;
    assert.equal(lines.length,4);
    assert.match(lines[0].innerHTML,/turn 1/);
    assert.match(lines[2].innerHTML,/turn 2/);
    assert.equal(h.history.length,6);
    assert.equal(h.history[0].text,'turn 0');
  } finally { h.cleanup(); }
});

test('long silence recycles bounded recordings while the mic stays live without uploads', async () => {
  const h = harness();
  try {
    await h.open();
    for(let i=0;i<6;i++) {h.tick(16000);await until(()=>h.recordings.length===i+2);}
    assert.equal(h.requests.length,0);
    assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),'false');
    assert.equal(h.streams.length,1);
    assert.equal(h.streams[0].getTracks()[0].enabled,true);
    assert.equal(h.recordings.at(-1).state,'recording');
    assert.ok(h.recordings.slice(0,-1).every(r=>r.state==='inactive'));
  } finally { h.cleanup(); }
});

test('close aborts transcription and ignores a late result after reopen', async () => {
  let respond;
  const h = harness({ transcribe: () => new Promise(resolve => { respond = resolve; }) });
  try {
    await h.open(); await h.finish();
    const request = h.requests[0];
    h.root.SageVoice.close(); h.root.SageVoice.open();
    respond({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"transcript":"stale words","unclear":false}' }] } }] }) });
    await delay(40);
    assert.equal(request.signal.aborted,true);
    assert.equal(h.asks.length,0);
    assert.equal(h.streams[0].getTracks()[0].readyState,'ended');
  } finally { h.cleanup(); }
});

test('mute during permission request cancels capture; retry uses just one stream', async () => {
  let allow;
  const h = harness({ getUserMedia: () => new Promise(resolve => { allow = resolve; }) });
  try {
    h.root.SageVoice.open();
    h.nodes.get('sageVoiceMic').emit('click');
    allow(h.newStream()); await delay(20);
    assert.equal(h.recordings.length,0);
    assert.equal(h.streams[0].getTracks()[0].enabled,false);
    h.nodes.get('sageVoiceMic').emit('click');
    await until(() => h.recordings.length === 1);
    assert.equal(h.streams.length,1);
    assert.equal(h.streams[0].getTracks()[0].enabled,true);
  } finally { h.cleanup(); }
});

test('permission failure is recoverable and no recording starts', async () => {
  const h = harness({ getUserMedia: async () => { throw Object.assign(new Error('blocked'),{name:'NotAllowedError'}); } });
  try {
    h.root.SageVoice.open(); await delay(20);
    assert.match(h.nodes.get('sageVoiceHint').textContent,/Allow microphone/);
    assert.equal(h.recordings.length,0);
    assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),'true');
  } finally { h.cleanup(); }
});


test('backgrounding preserves the room and resumes capture on return', async () => {
  const h=harness();
  try {
    await h.open();h.root.document.hidden=true;
    h.root.document.events.visibilitychange.forEach(fn=>fn());
    assert.equal(h.root.SageVoice.isOpen(),true);
    assert.equal(h.streams[0].getTracks()[0].readyState,'ended');
    h.root.document.hidden=false;h.root.document.events.visibilitychange.forEach(fn=>fn());
    await until(()=>h.recordings.length===2);
    h.nodes.get('sageVoiceMic').emit('click');
    h.root.document.hidden=true;h.root.document.events.visibilitychange.forEach(fn=>fn());
    h.root.document.hidden=false;h.root.document.events.visibilitychange.forEach(fn=>fn());
    await delay(20);assert.equal(h.recordings.length,2,'manual mute survives tab switching');
  } finally {h.cleanup();}
});



test('closing while permission is pending stops the late stream', async () => {
  let allow;
  const h = harness({getUserMedia: () => new Promise(resolve => { allow=resolve; })});
  try {
    h.root.SageVoice.open(); h.root.SageVoice.close();
    const stream = h.newStream(); allow(stream); await delay(20);
    assert.equal(stream.getTracks()[0].readyState,'ended');
    assert.equal(h.recordings.length,0);
  } finally { h.cleanup(); }
});

test('quota errors keep a fresh mic without resubmitting the failed audio', async () => {
  const h=harness({transcribe:async()=>({ok:false,status:429})});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    assert.match(h.nodes.get('sageVoiceHint').textContent,/quota/);
    assert.equal(h.requests.filter(r=>!r.body.generationConfig.responseModalities).length,2);
    assert.equal(h.asks.length,0);assert.equal(h.streams.length,1);
  } finally {h.cleanup();}
});

test('closing during an AI answer prevents old reply/history writes in a new session', async () => {
  let reply;
  const h = harness({askSage: () => new Promise(resolve => { reply=resolve; })});
  try {
    await h.open();
    const pending = h.root.SageVoice.sendVoiceText('old question');
    h.root.SageVoice.close(); h.root.SageVoice.open();
    reply({ok:true,text:'stale answer'}); await pending;
    assert.equal(h.history.length,1);
    assert.equal(h.nodes.get('sageVoiceLines').children.length,0);
  } finally { h.cleanup(); }
});

test('interrupt aborts pending speech audio and immediately resumes listening', async () => {
  const h = harness();
  try {
    await h.open();
    let signal;
    h.root.fetch = (_, init) => new Promise((resolve,reject) => {
      signal = init.signal;
      signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})));
    });
    const speaking = h.root.SageVoice.sendVoiceText('test interruption');
    await until(()=>signal);
    h.nodes.get('sageVoiceOrb').emit('click');
    await speaking;
    await until(()=>h.recordings.length===2);
    assert.equal(signal.aborted,true);
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Listening…');
  } finally { h.cleanup(); }
});


test('microphone stays stopped until the audio source actually ends', async () => {
  const h = harness({holdPlayback:true});
  try {
    await h.open();
    const reply = h.root.SageVoice.sendVoiceText('play the reply');
    await until(()=>h.playback.length===1);
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Replying…');
    assert.equal(h.recordings.length,1);
    assert.equal(h.recordings[0].state,'inactive');
    await delay(40);
    assert.equal(h.recordings.length,1);
    h.playback[0].end(); await reply;
    await until(()=>h.recordings.length===2);
  } finally { h.cleanup(); }
});

for (const [name,option] of [['silent PCM','silentAudio'],['empty PCM','emptyAudio'],['blocked audio context','audioBlocked']]) {
  test(`${name} offers recovery without treating provider failures as manual mute`, async () => {
    const h = harness({[option]:true});
    try {
      await h.open(); await h.root.SageVoice.sendVoiceText('test failed playback');
      assert.equal(h.recordings.length,option==='audioBlocked'?1:2);
      assert.equal(h.playback.length,0);
      assert.equal(h.nodes.has('sageVoiceReplay'),false);
      assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),option==='audioBlocked'?'true':'false');
      assert.match(h.nodes.get('sageVoiceHint').textContent,/orb|saved in chat/);
    } finally { h.cleanup(); }
  });
}

test('one English TTS request starts playback before the stream finishes',async()=>{
  const h=harness({holdPlayback:true,askSage:async()=>({ok:true,text:'Tell me what happened.'})});
  let controller,requests=0;
  const event=(finish=false)=>new TextEncoder().encode('data: '+JSON.stringify({candidates:[{content:{parts:[{inlineData:{data:Buffer.concat([speechPCM,speechPCM]).toString('base64'),mimeType:'audio/L16;rate=24000'}}]},...(finish?{finishReason:'STOP'}:{})}]})+'\n\n');
  try {
    await h.open();
    h.root.fetch=async(url,init)=>{
      requests++;const body=JSON.parse(init.body);
      assert.match(url,/streamGenerateContent/);
      assert.equal(body.generationConfig.speechConfig.voiceConfig.voice,'Kore');
      assert.equal(body.contents[0].parts[0].text,'Tell me what happened.');
      return {ok:true,status:200,headers:new Headers({'content-type':'text/event-stream'}),body:new ReadableStream({start(c){controller=c;c.enqueue(event());}})};
    };
    const reply=h.root.SageVoice.sendVoiceText('hello');
    await until(()=>h.playback.length===1);
    assert.equal(requests,1);assert.equal(h.recordings.length,1);
    h.playback[0].end();controller.enqueue(event(true));controller.close();
    await until(()=>h.playback.length===2);h.playback[1].end();await reply;
    await until(()=>h.recordings.length===2);
    assert.equal(requests,1);
  } finally {h.cleanup();}
});

test('missing Gemini key pauses explicitly without switching recognizers', async () => {
  const h=harness({noKey:true});
  try {
    h.root.SageVoice.open(); await delay(20);
    assert.equal(h.recognition.length,0);
    assert.equal(h.recordings.length,0);
    assert.equal(h.nodes.get('sageVoiceOverlay').getAttribute('data-recognition'),'gemini-transcribe');
    assert.match(h.nodes.get('sageVoiceHint').textContent,/Gemini key/);
  } finally { h.cleanup(); }
});


test('audio recognition and a 900ms breathing pause are defaults; quick and patient remain available', async () => {
  const h=harness({storage:{sage_voice_pause:null}});
  const careful=harness({storage:{sage_voice_speed:'careful',sage_voice_pause:'patient'}});
  try {
    assert.equal(h.root.SageVoice.settings.pauseMs,900);
    assert.equal(harness().root.SageVoice.settings.pauseMs,650);
    await h.open(); await h.finish();
    assert.match(h.requests[0].url,/gemini-3.5-flash:generateContent/);
    assert.equal(careful.root.SageVoice.settings.pauseMs,1200);
    await careful.open(); await careful.finish();
    assert.match(careful.requests[0].url,/gemini-3.5-flash:generateContent/);
  } finally {h.cleanup();careful.cleanup();}
});

test('temporary silence retries automatically, then resumes listening without a replay button', async () => {
  const options={silentAudio:true}, h=harness(options);
  try {
    await h.open(); const fetch=h.root.fetch; let count=0;
    h.root.fetch=(...args)=>{if(++count===2) options.silentAudio=false;return fetch(...args);};
    await h.root.SageVoice.sendVoiceText('reply');
    assert.equal(count,2);assert.equal(h.playback.length,1);assert.equal(h.recordings.length,2);
    assert.equal(h.nodes.has('sageVoiceReplay'),false);assert.equal(h.history.length,2);
  } finally {h.cleanup();}
});

test('empty transcription returns to listening instead of muting',async()=>{
  const h=harness({transcript:{transcript:'',unclear:false}});
  try {
    await h.open();await h.finish();await until(()=>h.recordings.length===2);
    assert.equal(h.asks.length,0);
    assert.equal(h.requests.length,1);
    assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),'false');
  } finally {h.cleanup();}
});

for(const action of ['mute','close']) {
  test(`${action} during silent-buffer rollover prevents automatic reopening`,async()=>{
    const h=harness();
    try {
      await h.open();h.tick(16000);
      if(action==='mute') h.nodes.get('sageVoiceMic').emit('click');
      else h.root.SageVoice.close();
      await delay(30);
      assert.equal(h.recordings.length,1);
      assert.equal(h.recordings[0].state,'inactive');
      assert.equal(h.requests.length,0);
    } finally {h.cleanup();}
  });
}


test('automatic playback retry preserves an explicit manual mute',async()=>{
  const options={silentAudio:true},h=harness(options);
  try {
    await h.open();h.nodes.get('sageVoiceMic').emit('click');
    const fetch=h.root.fetch;let count=0;
    h.root.fetch=(...args)=>{if(++count===2) options.silentAudio=false;return fetch(...args);};
    await h.root.SageVoice.sendVoiceText('reply while muted');
    assert.equal(h.playback.length,1);assert.equal(h.recordings.length,1);
    assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),'true');
  } finally {h.cleanup();}
});

test('the microphone stays off throughout the automatic retry and resumed audio',async()=>{
  const options={silentAudio:true,holdPlayback:true},h=harness(options);
  try {
    await h.open();const fetch=h.root.fetch;let count=0;
    h.root.fetch=(...args)=>{if(++count===2) options.silentAudio=false;return fetch(...args);};
    const reply=h.root.SageVoice.sendVoiceText('reply');
    await until(()=>h.playback.length===1);assert.equal(h.recordings.length,1);
    assert.equal(h.recordings[0].state,'inactive');h.playback[0].end();await reply;
    await until(()=>h.recordings.length===2);
  } finally {h.cleanup();}
});

test('speech beginning at the silent-buffer deadline is not discarded',async()=>{
  const h=harness({loud:true});
  try {
    await h.open();h.tick(15000);await delay(20);
    assert.equal(h.recordings.length,1);
    assert.equal(h.recordings[0].state,'recording');
    h.tick(200);assert.equal(h.recordings.length,1);
  } finally {h.cleanup();}
});


test('more than four exchanges keep listening and hide activity outside website tools',async()=>{
 const h=harness();try {
  await h.open();
  for(let i=0;i<8;i++) {await h.root.SageVoice.sendVoiceText('சொல்லு டா '+i);await until(()=>h.recordings.length===i+2);}
  assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),'false');
  assert.equal(h.nodes.get('sageVoiceActivity').hidden,true);
  assert.equal(h.requests.length,8,'one audio request per reply');
 }finally{h.cleanup();}
});

test('streaming TTS keeps the successful model and speaker across bilingual turns and reopening',async()=>{
  const h=harness({storage:{sage_voice_tts_model:'gemini-3.8-flash-tts'}});
  try {await h.open();
    await h.root.SageVoice.sendVoiceText('சொல்லு டா');await h.root.SageVoice.sendVoiceText('English reply');
    h.root.SageVoice.close();await h.open();await h.root.SageVoice.sendVoiceText('Another English reply');
    assert.equal(h.requests.length,3);
    assert.ok(h.requests.every(r=>r.url.includes('gemini-3.8-flash-tts')));
    assert.equal(h.storage.get('sage_voice_tts_model'),'gemini-3.8-flash-tts');
    assert.ok(h.requests.every(r=>r.body.generationConfig.speechConfig.voiceConfig.voice==='Kore'));
    assert.ok(h.requests.every(r=>r.body.contents[0].parts[0].speech_metadata.style===''));
  } finally {h.cleanup();}
});
test('access errors on the first reply retry another key without changing the saved model or voice',async()=>{
  const h=harness({storage:{sage_voice_tts_model:'gemini-3.8-flash-tts'}});const calls=[];
  try {await h.open();const fetch=h.root.fetch;
    h.root.SageAI.availableKeys=()=>[{key:'test-only'},{key:'test-other'}];
    h.root.fetch=(url,init)=>{calls.push({url,key:init.headers['x-goog-api-key']});return calls.length===1?Promise.resolve({ok:false,status:403}):fetch(url,init);};
    await h.root.SageVoice.sendVoiceText('hello');
    assert.equal(calls.length,2);assert.equal(calls[0].url,calls[1].url);
    assert.notEqual(calls[0].key,calls[1].key);assert.equal(h.playback.length,1);
    assert.equal(h.storage.get('sage_voice_tts_model'),'gemini-3.8-flash-tts');
  }finally{h.cleanup();}
});
test('an unavailable first-reply model cannot quietly select another model on each wake',async()=>{
  const h=harness({storage:{sage_voice_tts_model:'gemini-3.8-flash-lite-tts'}});const calls=[];
  try {await h.open();h.root.fetch=async(url)=>{calls.push(url);return {ok:false,status:404};};
    await h.root.SageVoice.sendVoiceText('hello');h.root.SageVoice.close();await h.open();
    await h.root.SageVoice.sendVoiceText('hello again');
    assert.equal(calls.length,2);assert.equal(calls[0],calls[1]);
    assert.equal(h.playback.length,0);assert.equal(h.root.SageVoice.isOpen(),true);
  }finally{h.cleanup();}
});
test('a new setup can choose one available voice model and retain that first successful voice',async()=>{
  const h=harness();const calls=[];
  try {await h.open();const fetch=h.root.fetch;
    h.root.fetch=(url,init)=>{calls.push(url);return url.includes('flash-lite-tts')?Promise.resolve({ok:false,status:404}):fetch(url,init);};
    await h.root.SageVoice.sendVoiceText('hello');h.root.SageVoice.close();await h.open();
    await h.root.SageVoice.sendVoiceText('வணக்கம்');
    assert.equal(calls.length,3);assert.equal(calls.filter(url=>url.includes('flash-lite-tts')).length,1);
    assert.equal(h.storage.get('sage_voice_tts_model'),'gemini-3.8-flash-tts');assert.equal(h.playback.length,2);
  }finally{h.cleanup();}
});
test('Viky stays in the visible English reply with one speech-only pronunciation',async()=>{
  for(const reply of ['Hello Viky.','Tell me more, Viky.']) {
    const h=harness({askSage:async()=>({ok:true,text:reply})});
    try {await h.open();await h.root.SageVoice.sendVoiceText('hello');
      assert.equal(h.history.at(-1).text,reply);
      assert.equal(h.requests[0].body.contents[0].parts[0].text,reply.replace('Viky','Vik-ee'));
    }finally{h.cleanup();}
  }
});
test('truncated audio before playback retries once and then recovers the mic',async()=>{
  const h=harness({fastRestarts:true});
  try {await h.open();h.root.fetch=async()=>({ok:true,headers:new Headers({'content-type':'text/event-stream'}),
    body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({candidates:[{content:{parts:[{inlineData:{data:speechPCM.toString('base64'),mimeType:'audio/L16;rate=24000'}}]}}]})+'\n\n'));c.close();}})});
    await h.root.SageVoice.sendVoiceText('reply');await until(()=>h.recordings.length===2);
    assert.equal(h.nodes.has('sageVoiceReplay'),false);assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),'false');
  } finally {h.cleanup();}
});

const transcriptResponse = (text='சொல்லு டா') => ({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({transcript:text,unclear:false})}]}}]})});
const sttError = (status,message='unavailable') => ({ok:false,status,json:async()=>({error:{message}})});
test('unavailable recognition model falls back on the same audio and remembers the route',async()=>{
  let calls=0;const h=harness({transcribe:async()=>++calls===1?sttError(404):transcriptResponse()});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    const first=h.requests.filter(r=>!r.body.generationConfig.responseModalities);
    assert.equal(first.length,2);assert.match(first[1].url,/gemini-3.5-flash-lite/);
    assert.equal(first[0].body.contents[0].parts[0].inlineData.data,first[1].body.contents[0].parts[0].inlineData.data);
    assert.equal(first[0].body.generationConfig.thinkingConfig.thinkingLevel,'minimal');
    await h.finish();await until(()=>h.recordings.length===3);
    assert.match(h.requests.filter(r=>!r.body.generationConfig.responseModalities).at(-1).url,/gemini-3.5-flash-lite/);
  }finally{h.cleanup();}
});
test('unsupported thinking option retries once without it, preserving schema safeguards',async()=>{
  let calls=0;const h=harness({transcribe:async()=>++calls===1?sttError(400,'thinkingLevel is not supported'):transcriptResponse()});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    assert.equal(h.requests[1].body.generationConfig.thinkingConfig,undefined);
    assert.ok(h.requests[1].body.generationConfig.responseSchema.required.includes('unclear'));
  }finally{h.cleanup();}
});
test('recognition outage asks aloud and listens afresh without an old-audio retry or brain turn',async()=>{
  let failing=true;const h=harness({transcribe:async()=>failing?sttError(503):transcriptResponse()});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    assert.equal(h.requests.filter(r=>!r.body.generationConfig.responseModalities).length,3);
    assert.equal(h.asks.length,0);assert.equal(h.playback.length,1);
    assert.match(h.nodes.get('sageVoiceLines').children.at(-1).innerHTML,/say it again/);
    assert.equal(h.nodes.has('sageVoiceSTTRetry'),false);assert.equal(h.streams.length,1);
    await delay(30);assert.equal(h.requests.length,4,'no background retry');
    failing=false;h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===3);
    assert.equal(h.decoded.length,2,'fresh audio is decoded, never a saved recording');assert.equal(h.asks.length,1);
  }finally{h.cleanup();}
});
test('invalid key has an honest hint, stays listening and skips unchanged rejected keys',async()=>{
  const h=harness({transcribe:async()=>sttError(400,'API key not valid')});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    assert.match(h.nodes.get('sageVoiceHint').textContent,/key was rejected/);
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===3);
    assert.equal(h.requests.filter(r=>!r.body.generationConfig.responseModalities).length,1);
    assert.equal(h.nodes.has('sageVoiceSTTBrowser'),false);assert.ok(h.recognition.length>=1);
  }finally{h.cleanup();}
});
test('quota cooldown allows fresh listening but bounds requests until the key is ready',async()=>{
  const h=harness({transcribe:async()=>sttError(429)});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===3);
    assert.equal(h.requests.filter(r=>!r.body.generationConfig.responseModalities).length,2);
    assert.match(h.nodes.get('sageVoiceHint').textContent,/60 seconds/);
    h.tick(60001);await until(()=>h.recordings.length===4);
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===5);
    assert.equal(h.requests.filter(r=>!r.body.generationConfig.responseModalities).length,4);
  }finally{h.cleanup();}
});
test('closing recovery cancels its speech and cannot restart a closed call',async()=>{
  const h=harness({transcribe:async()=>sttError(503),holdPlayback:true});
  try {await h.open();await h.finish();await until(()=>h.playback.length===1);
    h.root.SageVoice.close();await delay(20);
    assert.equal(h.recordings.length,1);assert.equal(h.streams[0].getTracks()[0].readyState,'ended');
    assert.equal(h.root.SageVoice.isOpen(),false);
  }finally{h.cleanup();}
});

test('provider reply errors stay out of speech/history and hands-free capture resumes',async()=>{
  const h=harness({askSage:async()=>({ok:false,reason:'backoff',retryInMs:42000})});
  try{await h.open();await h.root.SageVoice.sendVoiceText('hello');
    await until(()=>h.recordings.length===2);
    assert.equal(h.requests.length,0,'no TTS for canned errors');
    assert.equal(h.history.length,1);assert.equal(h.history[0].role,'user');
    assert.equal(h.nodes.get('sageVoiceLines').children.length,1);
    assert.match(h.nodes.get('sageVoiceHint').textContent,/42 seconds/);
    assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),'false');
  }finally{h.cleanup();}
});


test('cold opening reuses one gesture-created context and waits for recorder readiness',async()=>{
  let allow;
  const h=harness({getUserMedia:()=>new Promise(resolve=>{allow=resolve;})});
  try{
    h.root.SageVoice.open();
    assert.equal(h.contexts.length,1,'audio context is created before the permission promise resolves');
    assert.equal(h.recognition.length,0,'browser recognition is never started');
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Connecting…');
    allow(h.newStream());await until(()=>h.recordings.length===1);
    assert.equal(h.contexts.length,1,'meter shares the unlocked context');
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Listening…');
  }finally{h.cleanup();}
});
test('speech end detection works without animation frames and hands off within one polling tick',async()=>{
  const options={loud:true},h=harness(options);
  try{
    await h.open();h.tick(100);h.tick(100);
    options.loud=false;h.tick(100);h.tick(649);
    assert.equal(h.recordings[0].state,'recording','brief within-phrase pause is retained');
    h.tick(51);
    assert.equal(h.recordings[0].state,'inactive');
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Processing…');
    await until(()=>h.asks.length===1);
  }finally{h.cleanup();}
});
const pcmEvent=(bytes,finish=false)=>new TextEncoder().encode('data: '+JSON.stringify({candidates:[{content:{parts:[{inlineData:{data:bytes.toString('base64'),mimeType:'audio/L16;rate=24000'}}]},...(finish?{finishReason:'STOP'}:{})}]})+'\n\n');
test('audio chunks are scheduled contiguously before earlier onended; interrupt stops every queued source',async()=>{
  const h=harness({holdPlayback:true});let controller;
  try{
    await h.open();h.root.fetch=async()=>({ok:true,headers:new Headers({'content-type':'text/event-stream'}),body:new ReadableStream({start(c){controller=c;}})});
    const reply=h.root.SageVoice.sendVoiceText('reply');await until(()=>controller);
    const chunk=Buffer.concat([speechPCM,speechPCM]);
    controller.enqueue(pcmEvent(chunk));await until(()=>h.playback.length===1);
    controller.enqueue(pcmEvent(chunk));await until(()=>h.playback.length===2);
    assert.equal(h.playback[1].startAt,h.playback[0].startAt+h.playback[0].buffer.duration/1.08);
    assert.equal(h.recordings.length,1,'mic remains off while scheduled sources play');
    h.nodes.get('sageVoiceOrb').emit('click');controller.close();await reply;
    assert.ok(h.playback.every(s=>s.stopped));await until(()=>h.recordings.length===2);
  }finally{h.cleanup();}
});
test('tiny and odd-byte PCM packets are reassembled without missing or shifted samples',async()=>{
  const h=harness();const bytes=Buffer.concat([speechPCM,speechPCM]);
  try{
    await h.open();h.root.fetch=async()=>({ok:true,headers:new Headers({'content-type':'text/event-stream'}),body:new ReadableStream({start(c){
      for(let i=0;i<bytes.length;i+=31)c.enqueue(pcmEvent(bytes.subarray(i,i+31),i+31>=bytes.length));c.close();
    }})});
    await h.root.SageVoice.sendVoiceText('reply');
    const samples=h.playback.flatMap(p=>Array.from(p.buffer.samples));
    assert.equal(samples.length,bytes.length/2);
    for(let i=0;i<samples.length;i++)assert.equal(samples[i],bytes.readInt16LE(i*2)/32768);
  }finally{h.cleanup();}
});
test('direct speech cannot send a non-English script to the selected speaker',async()=>{
  const h=harness();
  try {
    await h.open();
    await assert.rejects(h.root.SageVoice.speak('வணக்கம்'),/english-only/);
    assert.equal(h.requests.length,0);
    assert.equal(h.playback.length,0);
    assert.equal(h.root.SageVoice.isOpen(),true);
  } finally { h.cleanup(); }
});
test('English uses a constant style and cannot switch models after speaking',async()=>{
  const h=harness();
  try{
    await h.open();await h.root.SageVoice.sendVoiceText('hello');
    const body=h.requests[0].body,style=body.contents[0].parts[0].speech_metadata.style;
    assert.equal(style,'');
    assert.doesNotMatch(style,/identity|pitch|accent|English|Tamil|feminine/);
    assert.equal(body.generationConfig.speechConfig.voiceConfig.voice,'Kore');
    let requests=0;h.root.fetch=async()=>{requests++;return {ok:false,status:404};};
    await h.root.SageVoice.sendVoiceText('சொல்லு டா');
    assert.equal(requests,1,'no silent model/voice switch mid-call');
    assert.equal(h.nodes.has('sageVoiceReplay'),false);
  }finally{h.cleanup();}
});


test('final audio STOP releases the mic after playback even when stream cancellation never settles',async()=>{
  const h=harness();let cancelled=false;
  try{
    await h.open();h.root.fetch=async()=>({ok:true,headers:new Headers({'content-type':'text/event-stream'}),body:new ReadableStream({
      start(c){c.enqueue(pcmEvent(speechPCM,true));},cancel(){cancelled=true;return new Promise(()=>{});}
    })});
    await h.root.SageVoice.sendVoiceText('reply');
    await until(()=>h.recordings.length===2);
    assert.equal(cancelled,true);assert.equal(h.nodes.has('sageVoiceReplay'),false);
  }finally{h.cleanup();}
});


test('transient HTTP failures retry the same speaker once, without another brain turn',async()=>{
  const h=harness();try{await h.open();const fetch=h.root.fetch;let count=0;
    h.root.fetch=(...args)=>++count===1?Promise.resolve({ok:false,status:503}):fetch(...args);
    await h.root.SageVoice.sendVoiceText('hello');
    assert.equal(count,2);assert.equal(h.asks.length,1);assert.equal(h.playback.length,1);assert.equal(h.history.length,2);
  }finally{h.cleanup();}
});
test('closing during automatic audio recovery cancels the retry',async()=>{
  const h=harness({silentAudio:true});try{await h.open();const pending=h.root.SageVoice.sendVoiceText('hello');
    await until(()=>h.requests.length===1);await delay(20);h.root.SageVoice.close();await pending;
    assert.equal(h.requests.length,1);assert.equal(h.playback.length,0);assert.equal(h.recordings.length,1);
  }finally{h.cleanup();}
});
test('backgrounding during retry does not leave a busy call when returning',async()=>{
  const h=harness({silentAudio:true});try{await h.open();const pending=h.root.SageVoice.sendVoiceText('hello');
    await until(()=>h.nodes.get('sageVoiceState').textContent==='Processing…');
    h.root.document.hidden=true;h.root.document.events.visibilitychange.forEach(fn=>fn());await pending;
    h.root.document.hidden=false;h.root.document.events.visibilitychange.forEach(fn=>fn());
    await until(()=>h.recordings.length===2);assert.equal(h.requests.length,1);
  }finally{h.cleanup();}
});
test('temporarily suspended output resumes automatically before requesting speech',async()=>{
  const h=harness();try{await h.open();const ctx=h.contexts[0];ctx.state='suspended';ctx.resume=async()=>{ctx.state='running';};
    await h.root.SageVoice.sendVoiceText('hello');assert.equal(h.playback.length,1);assert.equal(h.recordings.length,2);
    assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),'false');
  }finally{h.cleanup();}
});
test('speaker, style and playback speed stay identical across input languages in one call',async()=>{
  const h=harness({storage:{sage_voice_gem:'Aoede',sage_voice_rate:'1.08'}});
  try{await h.open();await h.root.SageVoice.sendVoiceText('hello');h.storage.set('sage_voice_gem','Kore');h.storage.set('sage_voice_rate','1.3');
    await h.root.SageVoice.sendVoiceText('வணக்கம்');
    const speech=h.requests.filter(r=>r.body.generationConfig.responseModalities);
    assert.equal(speech.length,2);assert.equal(speech[0].url,speech[1].url);
    for(const r of speech){assert.equal(r.body.generationConfig.speechConfig.voiceConfig.voice,'Aoede');assert.equal(r.body.contents[0].parts[0].speech_metadata.style,'');}
    assert.ok(h.playback.every(p=>p.playbackRate.value===1.08));
  }finally{h.cleanup();}
});

test('audio that has already started is not repeated after a broken stream',async()=>{
  const h=harness({holdPlayback:true});let count=0;
  try{await h.open();h.root.fetch=async()=>{count++;return {ok:true,headers:new Headers({'content-type':'text/event-stream'}),body:new ReadableStream({start(c){c.enqueue(pcmEvent(Buffer.concat([speechPCM,speechPCM])));c.close();}})};};
    await h.root.SageVoice.sendVoiceText('hello');assert.equal(count,1);assert.equal(h.playback.length,1);
    assert.equal(h.recordings.length,2);assert.equal(h.root.SageVoice.isOpen(),true);
  }finally{h.cleanup();}
});
test('voice quota does not trigger a rapid retry loop or close the call',async()=>{
  const h=harness();let count=0;try{await h.open();h.root.fetch=async()=>{count++;return {ok:false,status:429};};
    await h.root.SageVoice.sendVoiceText('hello');assert.equal(count,1);assert.equal(h.recordings.length,2);
    assert.equal(h.root.SageVoice.isOpen(),true);assert.match(h.nodes.get('sageVoiceHint').textContent,/quota/);
  }finally{h.cleanup();}
});
test('quota rotates keys with the same speaker/model and does not reuse the resting key on wake',async()=>{
  const h=harness();const calls=[];
  try {await h.open();const fetch=h.root.fetch;
    h.root.SageAI.availableKeys=()=>[{key:'test-only'},{key:'test-other'}];
    h.root.fetch=(url,init)=>{calls.push({url,key:init.headers['x-goog-api-key'],body:JSON.parse(init.body)});return calls.length===1?Promise.resolve({ok:false,status:429}):fetch(url,init);};
    await h.root.SageVoice.sendVoiceText('hello');h.root.SageVoice.close();await h.open();
    await h.root.SageVoice.sendVoiceText('வணக்கம்');
    assert.equal(calls.length,3);assert.deepEqual(calls.map(c=>c.key),['test-only','test-other','test-other']);
    assert.equal(new Set(calls.map(c=>c.url)).size,1);
    assert.ok(calls.every(c=>c.body.generationConfig.speechConfig.voiceConfig.voice==='Kore'));
  }finally{h.cleanup();}
});
test('a late voice access failure after closing cannot change the next call’s model',async()=>{
  const h=harness();let resolve;
  try {await h.open();const fetch=h.root.fetch;
    h.root.fetch=()=>new Promise(r=>{resolve=r;});
    const old=h.root.SageVoice.sendVoiceText('hello');await until(()=>resolve);
    h.root.SageVoice.close();await old;await h.open();h.root.fetch=fetch;
    resolve({ok:false,status:404});await delay(10);
    await h.root.SageVoice.sendVoiceText('next call');
    assert.match(h.requests[0].url,/gemini-3.8-flash-lite-tts/);assert.equal(h.playback.length,1);
  }finally{h.cleanup();}
});

test('first PCM words are buffered through delayed Live setup and committed once without a second upload',async()=>{
  const h=harness({live:true,autoSetup:false,liveEnd:ws=>ws.message({serverContent:{turnComplete:true}})});
  try {
    await h.open();await until(()=>h.worklets.length===1 && h.sockets[0].sent.length===1);
    const ws=h.sockets[0];h.worklets[0].frame();
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Connecting…');
    assert.match(h.nodes.get('sageVoiceInstruction').textContent,/First words are kept/);
    assert.equal(ws.sent.filter(m=>m.realtimeInput?.audio).length,0);
    ws.message({setupComplete:{}});await until(()=>ws.sent.some(m=>m.realtimeInput?.audio));
    await until(()=>h.nodes.get('sageVoiceState').textContent==='Listening…');
    assert.equal(Buffer.from(ws.sent.find(m=>m.realtimeInput?.audio).realtimeInput.audio.data,'base64').equals(speechPCM),true);
    ws.message({serverContent:{inputTranscription:{text:'Hello, how are you?'}}});
    await until(()=>h.nodes.get('sageVoiceCaption').innerHTML.includes('Hello'));
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===2);
    assert.deepEqual(h.asks,['Hello, how are you?']);assert.equal(h.decoded.length,0);
    assert.equal(h.requests.length,1,'only the spoken reply, no batch transcription');
    assert.equal(h.recognition.length,0);assert.equal(h.sockets.length,1,'working recognition stays connected across replies');
  }finally{h.cleanup();}
});

test('slow first worklet startup visibly waits and submits the whole recording once',async()=>{
  let ready;const h=harness({live:true,loud:true,addModule:()=>new Promise(resolve=>{ready=resolve;})});
  try {await h.open();
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Connecting…');
    assert.match(h.nodes.get('sageVoiceInstruction').textContent,/mic is recording/);
    h.tick(200);ready();await until(()=>h.worklets.length===1);
    h.worklets[0].frame();await until(()=>h.nodes.get('sageVoiceState').textContent==='Listening…');
    assert.match(h.nodes.get('sageVoiceInstruction').textContent,/after your pause/);
    await h.finish();await until(()=>h.recordings.length===2);
    assert.equal(h.decoded[0],'first-LAST','late live capture never replaces the complete recording');
    assert.equal(h.asks.length,1);assert.equal(h.requests.filter(r=>!r.body.generationConfig.responseModalities).length,1);
  }finally{h.cleanup();}
});
test('a never-ready worklet falls back visibly instead of keeping startup indefinitely',async()=>{
  const h=harness({live:true,fastTimeouts:true,addModule:()=>new Promise(()=>{})});
  try {await h.open();await until(()=>h.nodes.get('sageVoiceState').textContent==='Listening…');
    assert.match(h.nodes.get('sageVoiceInstruction').textContent,/after your pause/);
    await h.finish();await until(()=>h.asks.length===1);
    assert.equal(h.decoded[0],'first-LAST');assert.equal(h.asks.length,1);
  }finally{h.cleanup();}
});
test('orb reads fresh microphone and reply samples, returns to silence, and releases its animation on close',async()=>{
  const h=harness({live:true,holdPlayback:true});
  const orb=h.nodes.get('sageVoiceOrb'),level=()=>Number(orb.style['--sage-voice-level']);
  try {await h.open();await until(()=>h.worklets.length===1);h.worklets[0].frame();
    h.analysers[0].sample=144;h.animate();assert.ok(level()>0.2,'PCM path still animates microphone input');
    h.analysers[0].sample=128;for(let i=0;i<30;i++)h.animate();assert.ok(level()<0.01);
    const reply=h.root.SageVoice.sendVoiceText('hello');await until(()=>h.playback.length===1);
    const output=h.analysers[1];output.sample=148;h.animate();assert.ok(level()>0.2,'reply audio drives the orb');
    output.sample=128;for(let i=0;i<30;i++)h.animate();assert.ok(level()<0.01,'silent reply has no fixed speaking boost');
    h.root.SageVoice.close();await reply;
    assert.equal(level(),0);assert.equal(output.disconnected,true);assert.equal(h.animationFrames.size,0);
  }finally{h.cleanup();}
});
test('server endpoint finishes a soft first utterance even under constant background energy',async()=>{
  const h=harness({live:true,loud:true,liveEnd:ws=>ws.message({serverContent:{turnComplete:true}})});
  try{await h.open();await until(()=>h.worklets.length===1);
    h.worklets[0].frame(.03);h.tick(100);h.tick(150);
    h.sockets[0].message({serverContent:{inputTranscription:{text:'சொல்லு டா'},generationComplete:true}});
    h.worklets[0].frame(.03,undefined,{speechMs:0,activeMs:0});h.tick(100);h.tick(650);
    await until(()=>h.recordings.length===2);assert.deepEqual(h.asks,['சொல்லு டா']);assert.equal(h.root.SageVoice.isOpen(),true);
  }finally{h.cleanup();}
});
test('late final segments after endpoint arrive before one complete submitted sentence',async()=>{
  const h=harness({live:true,liveEnd:ws=>{
    ws.message({serverContent:{generationComplete:true}});
    setTimeout(()=>ws.message({serverContent:{inputTranscription:{text:' ₹500 tomorrow.'}}}),80);
  }});
  try{await h.open();await until(()=>h.worklets.length===1);h.worklets[0].frame();
    h.sockets[0].message({serverContent:{inputTranscription:{text:'Remind me to pay'}}});
    await delay(15);h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===2);
    assert.deepEqual(h.asks,['Remind me to pay ₹500 tomorrow.']);assert.equal(h.history.length,2);
  }finally{h.cleanup();}
});
test('an interim arriving after microphone cutoff cannot submit the older committed fragment',async()=>{
  const h=harness({live:true,liveEnd:ws=>{
    ws.message({serverContent:{generationComplete:true}});
    setTimeout(()=>ws.message({serverContent:{interimInputTranscription:{text:' to service'}}}),80);
    setTimeout(()=>ws.message({serverContent:{inputTranscription:{text:' to service tomorrow.'}}}),320);
  }});
  try{await h.open();await until(()=>h.worklets.length===1);h.worklets[0].frame();
    h.sockets[0].message({serverContent:{inputTranscription:{text:'Remind me'}}});
    await delay(15);h.nodes.get('sageVoiceOrb').emit('click');await delay(250);
    assert.equal(h.asks.length,0);await until(()=>h.recordings.length===2);
    assert.deepEqual(h.asks,['Remind me to service tomorrow.']);
  }finally{h.cleanup();}
});
test('late committed words rearm the server endpoint rather than leaving the recorder running',async()=>{
  const h=harness({live:true,loud:true,liveEnd:ws=>ws.message({serverContent:{turnComplete:true}})});
  try{await h.open();await until(()=>h.worklets.length===1);
    const ws=h.sockets[0];h.worklets[0].frame(.03);h.tick(100);h.tick(150);
    ws.message({serverContent:{inputTranscription:{text:'சொல்லு'},generationComplete:true}});
    await delay(80);ws.message({serverContent:{inputTranscription:{text:' டா'}}});
    await delay(30);ws.message({serverContent:{turnComplete:true}});
    h.worklets[0].frame(.03,undefined,{speechMs:0,activeMs:0});h.tick(100);h.tick(650);
    await until(()=>h.recordings.length===2);assert.deepEqual(h.asks,['சொல்லு டா']);
  }finally{h.cleanup();}
});
test('waitingForInput expects more speech and does not end a still-speaking turn',async()=>{
  const h=harness({live:true,loud:true});
  try{await h.open();await until(()=>h.worklets.length===1);
    h.sockets[0].message({serverContent:{interimInputTranscription:{text:'Hello'},waitingForInput:true}});
    await delay(250);assert.equal(h.recordings[0].state,'recording');assert.equal(h.asks.length,0);
  }finally{h.cleanup();}
});
test('Live failure uses the same full recording and avoids another unavailable connection',async()=>{
  const h=harness({live:true});try{await h.open();await until(()=>h.worklets.length===1);
    h.sockets[0].message({error:{message:'Access unavailable'}});await delay(15);
    await h.finish();await until(()=>h.recordings.length===2);
    assert.equal(h.decoded[0],'first-LAST');assert.deepEqual(h.asks,['நேத்து petrol போட்டேன் bro']);
    assert.equal(h.sockets.length,1);assert.equal(h.root.SageVoice.isOpen(),true);
  }finally{h.cleanup();}
});
test('committed input after stream end submits without waiting for generated acknowledgement audio',async()=>{
  const h=harness({live:true,liveEnd:ws=>ws.message({serverContent:{inputTranscription:{text:'Hello there'}}})});
  try{await h.open();await until(()=>h.worklets.length===1);h.worklets[0].frame();
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===2);
    assert.deepEqual(h.asks,['Hello there']);assert.equal(h.decoded.length,0);
    assert.equal(h.requests.length,1,'no redundant batch upload');
  }finally{h.cleanup();}
});
test('stalled audio decoding cannot leave the room at Hearing you forever',async()=>{
  const h=harness({hangDecode:true,fastTimeouts:true});
  try{await h.open();h.nodes.get('sageVoiceOrb').emit('click');
    await until(()=>h.recordings.length===2);
    assert.match(h.nodes.get('sageVoiceHint').textContent,/timed out|repeat/i);
    assert.equal(h.asks.length,0);assert.equal(h.root.SageVoice.isOpen(),true);
  }finally{h.cleanup();}
});
test('a stalled response body is bounded even when fetch headers arrived successfully',async()=>{
  const h=harness({fastTimeouts:true,transcribe:async()=>({ok:true,json:()=>new Promise(()=>{})})});
  try{await h.open();h.nodes.get('sageVoiceOrb').emit('click');
    await until(()=>h.recordings.length===2);
    assert.match(h.nodes.get('sageVoiceHint').textContent,/timed out/);
    assert.equal(h.asks.length,0);assert.equal(h.root.SageVoice.isOpen(),true);
  }finally{h.cleanup();}
});
test('a worklet cleanup exception preserves recognition and does not strand the turn',async()=>{
  const h=harness({live:true,throwWorkletStop:true,liveEnd:ws=>ws.message({serverContent:{inputTranscription:{text:'சொல்லு டா'},turnComplete:true}})});
  try{await h.open();await until(()=>h.worklets.length===1);h.worklets[0].frame();
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===2);
    assert.deepEqual(h.asks,['சொல்லு டா']);assert.equal(h.root.SageVoice.isOpen(),true);
  }finally{h.cleanup();}
});
test('a silent Live session falls back to captured PCM once and skips unavailable recognition on the next turn',async()=>{
  const h=harness({live:true,fastTimeouts:true,hangDecode:true});
  try{await h.open();await until(()=>h.worklets.length===1);h.worklets[0].frame();h.worklets[0].frame();
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===2);
    assert.deepEqual(h.asks,['நேத்து petrol போட்டேன் bro']);assert.equal(h.decoded.length,0);
    const stt=h.requests.find(r=>!r.body.generationConfig.responseModalities).body;
    const wav=Buffer.from(stt.contents[0].parts[0].inlineData.data,'base64');
    assert.equal(wav.readUInt32LE(24),16000);assert.equal(wav.readUInt32LE(40),speechPCM.length*2);
    assert.equal(wav.subarray(44).equals(Buffer.concat([speechPCM,speechPCM])),true,'all PCM, including the prefix, is reused');
    assert.equal(h.sockets.length,1);assert.equal(h.sockets[0].readyState,3);
    assert.equal(h.recognition.length,0);
  }finally{h.cleanup();}
});
test('a missing recorder stop event still completes one PCM utterance and ignores a late event',async()=>{
  const h=harness({live:true,noStopEvent:true,liveEnd:ws=>ws.message({serverContent:{inputTranscription:{text:'Hello'},turnComplete:true}})});
  try{await h.open();await until(()=>h.worklets.length===1);h.worklets[0].frame();
    const first=h.recordings[0];h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===2);
    first.onstop();await delay(50);assert.deepEqual(h.asks,['Hello']);assert.equal(h.history.length,2);
  }finally{h.cleanup();}
});
test('a crashed worklet cannot hold recording on its stale last loud frame',async()=>{
  const h=harness({live:true});
  try{await h.open();await until(()=>h.worklets.length===1);h.worklets[0].frame(.03);h.tick(100);h.tick(110);
    h.worklets[0].onprocessorerror();h.tick(300);h.tick(700);await until(()=>h.recordings.length===2);
    assert.equal(h.decoded[0],'first-LAST');assert.equal(h.asks.length,1);assert.equal(h.root.SageVoice.isOpen(),true);
  }finally{h.cleanup();}
});
test('old Live captions and endpoint messages cannot affect the next call after close',async()=>{
  const h=harness({live:true});try{await h.open();await until(()=>h.worklets.length===1);
    const late=h.sockets[0].onmessage;h.root.SageVoice.close();await h.open();
    late({data:JSON.stringify({serverContent:{inputTranscription:{text:'close voice mode'},generationComplete:true}})});
    await delay(250);assert.equal(h.asks.length,0);assert.equal(h.root.SageVoice.isOpen(),true);
    assert.doesNotMatch(h.nodes.get('sageVoiceCaption').innerHTML,/close voice/);
  }finally{h.cleanup();}
});
test('opening status waits for microphone permission; old browser/review preferences cannot restore removed UI',async()=>{
  let allow;const h=harness({live:true,storage:{sage_voice_recognition:'browser',sage_voice_review:'true'},getUserMedia:()=>new Promise(resolve=>{allow=resolve;})});
  try{h.root.SageVoice.open();assert.equal(h.nodes.get('sageVoiceState').textContent,'Connecting…');
    assert.equal(h.recognition.length,0);assert.equal(h.nodes.has('sageVoiceReview'),false);assert.equal(h.nodes.has('sageVoiceMethod'),false);
    allow(h.newStream());await until(()=>h.recordings.length===1 && h.worklets.length===1);
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Connecting…');
    h.worklets[0].frame(0);await until(()=>h.nodes.get('sageVoiceState').textContent==='Listening…');
  }finally{h.cleanup();}
});
test('explicit bare close voice works locally and greetings/negations keep the room open',async()=>{
  for(const text of ['hello','வணக்கம்',"don't close voice",'how do I close voice']) {
    const h=harness();try{await h.open();await h.root.SageVoice.sendVoiceText(text);assert.equal(h.root.SageVoice.isOpen(),true);}finally{h.cleanup();}
  }
  for(const text of ['close voice','Can you please close voice?']) {
    const h=harness();try{await h.open();await h.root.SageVoice.sendVoiceText(text);assert.equal(h.root.SageVoice.isOpen(),false);assert.equal(h.requests.length,0);}finally{h.cleanup();}
  }
});

test('a single short first word ends on silence, replies once and automatically listens again',async()=>{
  const h=harness({live:true,liveEnd:ws=>ws.message({serverContent:{inputTranscription:{text:'Hello'}}})});
  try {
    await h.open();await until(()=>h.worklets.length===1);
    h.worklets[0].frame(.04,undefined,{speechMs:100,activeMs:100});h.tick(100);
    h.worklets[0].frame(.04,undefined,{speechMs:60,activeMs:60});h.tick(100);
    h.worklets[0].frame(0,undefined,{speechMs:0,activeMs:0});h.tick(100);
    assert.equal(h.nodes.get('sageVoiceOrb').getAttribute('data-speech-active'),'false');
    h.tick(650);assert.equal(h.recordings[0].state,'inactive');
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Processing…');
    await until(()=>h.recordings.length===2);assert.deepEqual(h.asks,['Hello']);
    assert.equal(h.history.length,2);assert.equal(h.root.SageVoice.isOpen(),true);
  }finally{h.cleanup();}
});
test('late interim captions do not restart a microphone silence deadline',async()=>{
  const h=harness({live:true,liveEnd:ws=>ws.message({serverContent:{inputTranscription:{text:'Hello there'}}})});
  try {
    await h.open();await until(()=>h.worklets.length===1);
    h.worklets[0].frame(.04);h.tick(100);h.worklets[0].frame(0);h.tick(100);h.tick(600);
    h.sockets[0].message({serverContent:{interimInputTranscription:{text:'Hello there'}}});await delay(10);
    h.tick(100);assert.equal(h.recordings[0].state,'inactive');
    await until(()=>h.recordings.length===2);assert.deepEqual(h.asks,['Hello there']);
  }finally{h.cleanup();}
});
test('cold audio startup during silence keeps the fast Live path once ready',async()=>{
  let ready;const h=harness({live:true,addModule:()=>new Promise(resolve=>{ready=resolve;}),
    liveEnd:ws=>ws.message({serverContent:{inputTranscription:{text:'First words'}}})});
  try {
    await h.open();h.tick(200);ready();await until(()=>h.worklets.length===1);
    h.worklets[0].frame();await until(()=>h.nodes.get('sageVoiceState').textContent==='Listening…');
    assert.match(h.nodes.get('sageVoiceInstruction').textContent,/Pause when/);
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===2);
    assert.deepEqual(h.asks,['First words']);assert.equal(h.decoded.length,0);
  }finally{h.cleanup();}
});
test('a transient worklet-load failure can retry on the same audio context',async()=>{
  const h=harness({live:true});let attempts=0;
  try {
    const context={audioWorklet:{addModule:async()=>{if(++attempts===1)throw new Error('Transient asset failure');}}};
    assert.equal(await h.root.SageTranscription.prepare(context),false);
    assert.equal(await h.root.SageTranscription.prepare(context),true);
    assert.equal(await h.root.SageTranscription.prepare(context),true);assert.equal(attempts,2);
  }finally{h.cleanup();}
});
test('Tamil close cancels an in-flight answer without waiting for it or playing stale audio',async()=>{
  let finish;const h=harness({askSage:()=>new Promise(resolve=>{finish=resolve;})});
  try {
    await h.open();const pending=h.root.SageVoice.sendVoiceText('hello');await until(()=>finish);
    await h.root.SageVoice.sendVoiceText('வாய்ஸ் மோட் க்ளோஸ் பண்ணு');
    assert.equal(h.root.SageVoice.isOpen(),false);assert.equal(h.streams[0].getTracks()[0].readyState,'ended');
    finish({ok:true,text:'Too late'});await pending;
    assert.equal(h.playback.length,0);assert.equal(h.history.filter(t=>t.role==='sage').length,0);
  }finally{h.cleanup();}
});

test('automatic recovery respects a manual mute and never unmutes it after asking again',async()=>{
  const h=harness({transcribe:async()=>sttError(503),holdPlayback:true});
  try {await h.open();await h.finish();await until(()=>h.playback.length===1);
    h.nodes.get('sageVoiceMic').emit('click');h.playback[0].end();await delay(25);
    assert.equal(h.recordings.length,1);assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),'true');
    h.nodes.get('sageVoiceMic').emit('click');await until(()=>h.recordings.length===2);
  }finally{h.cleanup();}
});

test('a replacement recognition key works immediately during a rejected-key cooldown',async()=>{
  let failing=true;const h=harness({transcribe:async()=>failing?sttError(401):transcriptResponse()});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    failing=false;h.root.SageAI.availableKeys=()=>[{key:'new-test-key'}];
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===3);
    assert.equal(h.asks.length,1);assert.equal(h.requests.filter(r=>!r.body.generationConfig.responseModalities).length,2);
  }finally{h.cleanup();}
});

test('dedicated English streaming setup requests text, language hint and domain vocabulary only',async()=>{
  const h=harness({live:true});
  try {await h.open();const setup=h.sockets[0].sent[0].setup;
    assert.equal(setup.model,'models/gemini-3.5-transcribe-live');assert.deepEqual(Array.from(setup.generationConfig.responseModalities),['TEXT']);
    assert.deepEqual(Array.from(setup.inputAudioTranscription.languageCodes),['en-IN']);assert.equal(setup.inputAudioTranscription.customVocabulary.includes('Viky'),false);
    assert.equal(setup.systemInstruction,undefined);assert.equal(setup.generationConfig.maxOutputTokens,undefined);
  }finally{h.cleanup();}
});
test('English browser fallback captures the next hello without another Gemini recognition request',async()=>{
  const h=harness({transcribe:async()=>sttError(429)});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    const rec=h.recognition.at(-1);assert.equal(rec.lang,'en-IN');assert.equal(rec.interimResults,true);
    rec.result('Hello there',false);assert.match(h.nodes.get('sageVoiceCaption').innerHTML,/Hello there/);
    assert.equal(h.asks.length,0,'interim never executes a command');
    rec.result('Hello there',true);h.tick(100);h.tick(651);await until(()=>h.recordings.length===3);
    assert.deepEqual(h.asks,['Hello there']);assert.equal(h.requests.filter(r=>!r.body.generationConfig.responseModalities).length,2);
    assert.equal(h.streams.length,1);assert.equal(h.root.SageVoice.isOpen(),true);
  }finally{h.cleanup();}
});
test('repeated service failures produce one spoken recovery row and no repeated announcements',async()=>{
  const h=harness({transcribe:async()=>sttError(503)});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===3);
    assert.equal(h.playback.length,1);assert.equal(h.nodes.get('sageVoiceLines').children.length,1);assert.equal(h.asks.length,0);
  }finally{h.cleanup();}
});
test('uncertain English fallback words ask again without sending a guessed write to the brain',async()=>{
  const h=harness({transcribe:async()=>sttError(429)});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    h.recognition.at(-1).result('delete record seven',true,.2);h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===3);
    assert.equal(h.asks.length,0);assert.match(h.nodes.get('sageVoiceLines').children.at(-1).innerHTML,/say it once more/);
  }finally{h.cleanup();}
});
test('a never-started English recognizer has bounded readiness and cannot remain Connecting forever',async()=>{
  const h=harness({transcribe:async()=>sttError(429),hangNative:true,fastTimeouts:true});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    await until(()=>h.nodes.get('sageVoiceState').textContent==='Listening…');
    assert.equal(h.root.SageVoice.isOpen(),true);assert.equal(h.requests.filter(r=>!r.body.generationConfig.responseModalities).length,2);
  }finally{h.cleanup();}
});

test('committed fragments during speech stay captions until a real endpoint or local pause',async()=>{
  const h=harness({live:true,loud:true,liveEnd:ws=>ws.message({serverContent:{turnComplete:true}})});
  try {await h.open();await until(()=>h.worklets.length===1);h.worklets[0].frame(.03);
    const ws=h.sockets[0];ws.message({serverContent:{inputTranscription:{text:'Set the cost'}}});
    await delay(260);assert.equal(h.recordings.length,1);assert.equal(h.recordings[0].state,'recording');assert.equal(h.asks.length,0);
    ws.message({serverContent:{inputTranscription:{text:'to five hundred rupees'}}});
    await delay(260);assert.equal(h.asks.length,0);assert.match(h.nodes.get('sageVoiceCaption').innerHTML,/Set the cost to five hundred/);
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===2);
    assert.deepEqual(h.asks,['Set the cost to five hundred rupees']);assert.equal(h.decoded.length,0);
  }finally{h.cleanup();}
});
test('a plain hello is preserved without rider-name context, and reply rows are labelled Sage',async()=>{
  const h=harness({transcribe:async()=>transcriptResponse('Hello')});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    assert.deepEqual(h.asks,['Hello']);
    const stt=h.requests.find(r=>!r.body.generationConfig.responseModalities);
    assert.equal(/Viky|rider.s name/i.test(stt.body.systemInstruction.parts[0].text),false);
    assert.match(stt.body.systemInstruction.parts[0].text,/do not converse/i);
    assert.match(h.nodes.get('sageVoiceLines').children.at(-1).innerHTML,/<strong>Sage<\/strong>/);
  }finally{h.cleanup();}
});

test('startup noise and unsolicited provider words cannot process silence or create a reply',async()=>{
  const h=harness({live:true});
  try {await h.open();await until(()=>h.worklets.length===1);
    const ws=h.sockets[0];
    h.worklets[0].frame(.03,undefined,{speechMs:100,activeMs:100});h.tick(100);
    h.worklets[0].frame(.025,undefined,{speechMs:0,activeMs:100});h.tick(100);
    ws.message({serverContent:{inputTranscription:{text:'hello Viky'},turnComplete:true}});
    h.tick(1000);await delay(220);
    assert.equal(h.asks.length,0);assert.equal(h.requests.length,0);assert.equal(h.recordings[0].state,'recording');
    assert.equal(ws.sent.some(m=>m.realtimeInput?.audio),false,'noise never reaches transcription');
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===2);
    assert.equal(h.requests.length,0,'manual send of classified silence stays local');
    assert.equal(h.sockets.length,1,'silence does not churn recognition connections');
  }finally{h.cleanup();}
});
test('six speech turns reuse one Live connection and discard late parked transcripts',async()=>{
  const h=harness({live:true,liveEnd:ws=>ws.message({serverContent:{inputTranscription:{text:'Hello'},turnComplete:true}}),holdPlayback:true});
  try {await h.open();await until(()=>h.worklets.length===1);
    const ws=h.sockets[0];
    for(let turn=0;turn<6;turn++){
      const pcm=h.worklets.at(-1);
      pcm.frame(.04,undefined,{speechMs:100,activeMs:100});h.tick(100);
      pcm.frame(.04,undefined,{speechMs:80,activeMs:100});h.tick(100);
      pcm.frame(0,undefined,{speechMs:0,activeMs:0});h.tick(100);h.tick(650);
      await until(()=>h.playback.length===turn+1);
      ws.message({serverContent:{inputTranscription:{text:'close voice mode'},turnComplete:true}});await delay(5);
      h.playback.at(-1).end();await until(()=>h.recordings.length===turn+2);
      assert.equal(h.sockets.length,1);assert.equal(h.streams.length,1);
      assert.equal(h.root.SageVoice.isOpen(),true);
    }
    assert.deepEqual(h.asks,Array(6).fill('Hello'));
    assert.equal(h.requests.length,6,'only TTS requests, no batch decoding or repeated setup');
    const speakers=h.requests.map(r=>r.body.generationConfig.speechConfig.voiceConfig.voice);
    assert.deepEqual([...new Set(speakers)],['Kore']);
  }finally{h.cleanup();}
});
test('one model reaching quota uses the alternative for the same audio and remembers the working route',async()=>{
  const h=harness({transcribe:async init=>init.body.includes('test-never')?sttError(500):transcriptResponse('Hello')});
  let count=0;h.root.fetch=async(url,init)=>{
    const body=JSON.parse(init.body);h.requests.push({url,body,signal:init.signal});
    if(body.generationConfig.responseModalities)return {ok:true,json:async()=>({candidates:[{content:{parts:[{inlineData:{data:speechPCM.toString('base64'),mimeType:'audio/L16;rate=24000'}}]}}]})};
    count++;return /gemini-3.5-flash:/.test(url)?sttError(429):transcriptResponse('Hello');
  };
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    assert.deepEqual(h.asks,['Hello']);assert.equal(h.recognition.length,0);
    await h.finish();await until(()=>h.recordings.length===3);
    assert.deepEqual(h.asks,['Hello','Hello']);assert.equal(count,3);
    const stt=h.requests.filter(r=>!r.body.generationConfig.responseModalities);
    assert.equal(stt[0].body.contents[0].parts[0].inlineData.data,stt[1].body.contents[0].parts[0].inlineData.data,'same recording, no need to repeat');
    assert.match(stt.at(-1).url,/flash-lite/);
    assert.equal(h.playback.length,2,'no spoken switching announcement');
  }finally{h.cleanup();}
});
test('quota recovery and browser no-speech events do not repeat switching speech or disable listening',async()=>{
  const h=harness({transcribe:async()=>sttError(429)});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    assert.equal(h.playback.length,0);assert.equal(h.nodes.get('sageVoiceLines').children.length,0);
    const native=h.recognition.at(-1);
    for(let i=0;i<4;i++){native.onerror?.({error:'no-speech'});native.onend?.();await delay(180);}
    assert.equal(native.starts,5);assert.equal(h.recordings.length,2);assert.equal(h.requests.length,2);
    native.result('Open the service page',true);h.tick(100);h.tick(650);await until(()=>h.recordings.length===3);
    assert.deepEqual(h.asks,['Open the service page']);assert.equal(h.streams.length,1);
    assert.equal(h.playback.length,1);assert.equal(h.requests.filter(r=>!r.body.generationConfig.responseModalities).length,2);
  }finally{h.cleanup();}
});

test('a failed parked socket is retired before the next speech and a replacement key connects',async()=>{
  const h=harness({live:true,holdPlayback:true,liveEnd:ws=>ws.message({serverContent:{inputTranscription:{text:'Hello'},turnComplete:true}})});
  try {await h.open();await until(()=>h.worklets.length===1);h.worklets[0].frame();
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.playback.length===1);
    h.sockets[0].message({error:{code:429,message:'quota'}});await delay(10);
    h.root.SageAI.availableKeys=()=>[{key:'test-only'},{key:'replacement'}];h.playback[0].end();
    await until(()=>h.recordings.length===2&&h.sockets.length===2);
    assert.equal(h.sockets[0].readyState,3);assert.equal(h.sockets[1].readyState,1);
    h.worklets.at(-1).frame();h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.playback.length===2);
    h.playback[1].end();await until(()=>h.recordings.length===3);
    assert.deepEqual(h.asks,['Hello','Hello']);assert.equal(h.sockets.length,2);
    assert.equal(h.requests.length,2,'no repeated batch or switching speech');
  }finally{h.cleanup();}
});

test('committed and interim Live captions have word boundaries without duplicating cumulative drafts',async()=>{
  const h=harness({live:true});
  try {await h.open();await until(()=>h.worklets.length===1);h.worklets[0].frame();
    const ws=h.sockets[0];
    ws.message({serverContent:{inputTranscription:{text:'Open'}}});await delay(5);
    ws.message({serverContent:{interimInputTranscription:{text:'the service page'}}});await delay(5);
    assert.match(h.nodes.get('sageVoiceCaption').innerHTML,/Open the service page/);
    ws.message({serverContent:{interimInputTranscription:{text:' open the documents page'}}});await delay(5);
    assert.match(h.nodes.get('sageVoiceCaption').innerHTML,/Open the documents page/);
    assert.doesNotMatch(h.nodes.get('sageVoiceCaption').innerHTML,/OpenOpen|Open Open/);
    ws.message({serverContent:{inputTranscription:{text:'the documents page'}}});await delay(5);
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===2);
    assert.deepEqual(h.asks,['Open the documents page']);assert.equal(h.decoded.length,0);
  }finally{h.cleanup();}
});
test('a queued Blob from a parked turn cannot become the next turn transcript',async()=>{
  const h=harness({live:true});let decode;const captions=[];
  try {const ears=h.root.SageTranscription.connect({key:'test-only',onText:t=>captions.push(t)});
    await ears.connected;const ws=h.sockets[0];ears.push(new ArrayBuffer(3200));
    ws.onmessage({data:{text:()=>new Promise(resolve=>{decode=resolve;})}});await delay(5);
    ears.park();ears.bind({onText:t=>captions.push(t),onBoundary(){}});ears.push(new ArrayBuffer(3200));
    ws.message({serverContent:{inputTranscription:{text:'Fresh words'}}});
    decode(JSON.stringify({serverContent:{inputTranscription:{text:'Stale close voice mode'}}}));await delay(10);
    assert.deepEqual(captions,['Fresh words']);assert.equal(ears.text,'Fresh words');ears.close();
  }finally{h.cleanup();}
});

test('Live does not add a longer speech-start gate than the local short-word confirmation',async()=>{
  const h=harness({live:true});
  try {await h.open();await until(()=>h.worklets.length===1 && h.sockets[0].sent.some(m=>m.setup));
    const detection=h.sockets[0].sent.find(m=>m.setup).setup.realtimeInputConfig.automaticActivityDetection;
    assert.equal(detection.disabled,false);assert.ok(detection.prefixPaddingMs<=120);
    h.worklets[0].frame(.04,undefined,{speechMs:100,activeMs:100});
    assert.equal(h.sockets[0].sent.some(m=>m.realtimeInput?.audio),false,'local noise gate still applies');
    h.worklets[0].frame(.04,undefined,{speechMs:60,activeMs:100});
    assert.equal(h.sockets[0].sent.some(m=>m.realtimeInput?.audio),true,'a short first word streams with its prefix');
  }finally{h.cleanup();}
});
test('a worklet that stalls mid-sentence uses the complete recorder, never its partial PCM or caption',async()=>{
  const h=harness({live:true,stallPCM:true,transcript:{transcript:'Open the documents page',unclear:false}});
  try {await h.open();await until(()=>h.worklets.length===1);h.worklets[0].frame();
    h.sockets[0].message({serverContent:{inputTranscription:{text:'Open'}}});await delay(10);
    h.tick(600);h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===2);
    assert.equal(h.decoded[0],'first-LAST');assert.deepEqual(h.asks,['Open the documents page']);
    assert.equal(h.requests.filter(r=>!r.body.generationConfig.responseModalities).length,1);
  }finally{h.cleanup();}
});
test('an unacknowledged worklet flush uses the full recording instead of clipping the last packet',async()=>{
  const h=harness({live:true,noPCMFlush:true,transcript:{transcript:'Open documents',unclear:false}});
  try {await h.open();await until(()=>h.worklets.length===1);h.worklets[0].frame();
    h.sockets[0].message({serverContent:{inputTranscription:{text:'Open'}}});await delay(10);
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===2);
    assert.equal(h.decoded[0],'first-LAST');assert.deepEqual(h.asks,['Open documents']);
  }finally{h.cleanup();}
});
test('a browser final arriving after stop and onend is used once without re-uploading audio',async()=>{
  const h=harness({transcribe:async()=>sttError(429)});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    const native=h.recognition.at(-1);native.result('Open the',false);
    native.stop=()=>{native.onend?.();setTimeout(()=>native.result('Open the documents page',true),350);};
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===3);
    assert.deepEqual(h.asks,['Open the documents page']);
    assert.equal(h.requests.filter(r=>!r.body.generationConfig.responseModalities).length,2,'only the original quota walk');
  }finally{h.cleanup();}
});
test('a browser restart without onstart is bounded just like the first startup',async()=>{
  const h=harness({transcribe:async()=>sttError(429),fastTimeouts:true});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    const native=h.recognition.at(-1);native.start=()=>{native.starts++;};
    native.onerror?.({error:'no-speech'});native.onend?.();
    await until(()=>native.starts===2);
    await until(()=>h.nodes.get('sageVoiceState').textContent==='Listening…');
    assert.equal(native.starts,2);assert.equal(h.root.SageVoice.isOpen(),true);
  }finally{h.cleanup();}
});
test('a configured key resting from the reply service is not mistaken for a missing key or allowed to retry quota',async()=>{
  const h=harness({noKey:true});
  try {
    h.root.SageAI.getKeys=()=>[{id:'test',key:'configured-but-resting'}];
    h.root.SageAI.readBackoff=()=>({keys:{test:{kind:'quota',until:220000}}});
    await h.open();assert.equal(h.recognition.length,1);
    assert.equal(h.recognition[0].lang,'en-IN');assert.equal(h.recordings[0].state,'recording');
    assert.doesNotMatch(h.nodes.get('sageVoiceHint').textContent,/Add or unlock|key was rejected/);
    h.recognition[0].result('open documents',true);h.nodes.get('sageVoiceOrb').emit('click');
    await until(()=>h.recordings.length===2);
    assert.deepEqual(h.asks,['open documents']);assert.equal(h.requests.length,0,'respect the whole-key cooldown');
    assert.equal(h.root.SageVoice.isOpen(),true);assert.equal(h.streams.length,1);
  }finally{h.cleanup();}
});
test('voice text strips Markdown while preserving filenames, English compounds, full captions and chat history',async()=>{
  const reply='**Viky**, check [your bill](https://example.test): `service_bill_2.pdf` and vitamin-a. Keep backup__bill__2.pdf.';
  const h=harness({live:true,askSage:async()=>({ok:true,text:reply})});
  try {await h.open();await until(()=>h.worklets.length===1);h.worklets[0].frame();
    const words='Please keep the first words. '+ 'All of these words matter. '.repeat(12);
    h.sockets[0].message({serverContent:{interimInputTranscription:{text:words}}});await delay(10);
    assert.match(h.nodes.get('sageVoiceCaption').innerHTML,/Please keep the first words/);
    await h.root.SageVoice.sendVoiceText('read my bill');
    const html=h.nodes.get('sageVoiceLines').children.at(-1).innerHTML;
    assert.match(html,/Viky, check your bill: service_bill_2.pdf and vitamin-a/);
    assert.doesNotMatch(html,/\*\*|`|https:\/\/example/);
    assert.match(h.requests[0].body.contents[0].parts[0].text,/service_bill_2.pdf and vitamin-a/);
    assert.match(html,/backup__bill__2.pdf/);
    assert.equal(h.history.at(-1).text,reply);
  }finally{h.cleanup();}
});
test('a browser service error cannot start an automatic recognition-error loop',async()=>{
  const h=harness({transcribe:async()=>sttError(429)});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    const rec=h.recognition.at(-1);rec.onerror?.({error:'network'});rec.onend?.();await delay(180);
    assert.equal(rec.starts,1);assert.equal(h.recordings.length,2);
    assert.equal(h.playback.length,0);assert.equal(h.root.SageVoice.isOpen(),true);
    assert.match(h.nodes.get('sageVoiceState').textContent,/Listening…/);
  }finally{h.cleanup();}
});


test('holding the orb cancels thinking immediately, keeps the call and ignores its stale answer',async()=>{
  let finish,signal,cancelled;
  const h=harness({live:true,askSage:(_text,opts)=>{signal=opts.signal;cancelled=opts.isCancelled;return new Promise(resolve=>{finish=resolve;});}});
  try {
    await h.open();await until(()=>h.worklets.length===1);
    const pending=h.root.SageVoice.sendVoiceText('Show my service history');await until(()=>finish);
    const orb=h.nodes.get('sageVoiceOrb');orb.emit('pointerdown',{button:0,pointerId:1,clientX:20,clientY:20});
    await until(()=>h.worklets.length===2);
    assert.equal(signal.aborted,true);assert.equal(cancelled(),true);assert.equal(h.root.SageVoice.isOpen(),true);
    h.worklets.at(-1).frame(0);await until(()=>h.nodes.get('sageVoiceState').textContent==='Listening…');
    orb.emit('pointerup',{pointerId:1});orb.emit('click');
    assert.equal(h.recordings.at(-1).state,'recording','release does not commit a silent take');
    finish({ok:true,text:'Stale answer'});await pending;
    assert.equal(h.playback.length,0);assert.equal(h.streams.length,1);assert.equal(h.history.filter(t=>t.role==='sage').length,0);
  }finally{h.cleanup();}
});
test('short orb press and a moved hold never cancel a processing turn',async()=>{
  let finish,signal;const h=harness({askSage:(_text,opts)=>{signal=opts.signal;return new Promise(resolve=>{finish=resolve;});}});
  try {
    await h.open();const pending=h.root.SageVoice.sendVoiceText('hello');await until(()=>finish);
    const orb=h.nodes.get('sageVoiceOrb');
    orb.emit('pointerdown',{button:0,pointerId:1,clientX:20,clientY:20});orb.emit('pointerup',{pointerId:1});
    orb.emit('pointerdown',{button:0,pointerId:2,clientX:20,clientY:20});orb.emit('pointermove',{pointerId:2,clientX:40,clientY:20});
    await delay(600);assert.equal(signal.aborted,false);
    finish({ok:true,text:'Okay'});await pending;
  }finally{h.cleanup();}
});
test('native words guessed during locally rejected background noise never run a command',async()=>{
  const h=harness({live:true,noKey:true});
  try {
    h.root.SageAI.getKeys=()=>[{id:'test',key:'configured-but-resting'}];await h.open();await until(()=>h.worklets.length===1&&h.recognition.length===1);
    h.worklets[0].frame(.08,undefined,{speechMs:0,activeMs:100});h.recognition[0].result('hello viky');
    h.tick(100);h.tick(1000);assert.equal(h.asks.length,0);assert.equal(h.recordings[0].state,'recording');
    assert.doesNotMatch(h.nodes.get('sageVoiceCaption').innerHTML,/hello/i);
  }finally{h.cleanup();}
});

test('browser-only noise hypotheses are validated locally before any brain/provider request',async()=>{
 const h=harness({live:true,noKey:true,recordedSpeech:false,addModule:async()=>{throw new Error('Worklet unavailable');}});
 try{
  h.root.SageAI.getKeys=()=>[{id:'test',key:'resting'}];await h.open();await until(()=>h.recognition.length===1);
  await until(()=>h.nodes.get('sageVoiceState').textContent==='Listening…');
  h.recognition[0].result('hello viky');h.nodes.get('sageVoiceOrb').emit('click');
  await until(()=>h.recordings.length===2);
  assert.equal(h.asks.length,0);assert.equal(h.requests.length,0);assert.equal(h.history.length,0);
 }finally{h.cleanup();}
});
