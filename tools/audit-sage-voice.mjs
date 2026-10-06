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
function harness(options = {}) {
  const timers = new Set(), intervals = new Map(), nodes = new Map(), streams = [], recordings = [], recognition = [];
  const asks = [], requests = [], decoded = [], playback = [], contexts = [];
  const sockets = [], worklets = [], analysers = [], animationFrames = new Map();
  let history = [], now = 100000;
  class Element {
    constructor(id = '') { this.id = id; this.children = []; this.events = {}; this.attrs = {}; this.hidden = false; this.value = ''; this.type = ''; this.isConnected = true; this.style = { setProperty(k,v) { this[k]=v; }, removeProperty(k) { delete this[k]; } }; this.classList = { add() {}, remove() {}, toggle() {} }; }
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
    emit(name) { this.events[name]?.forEach(fn => fn({ preventDefault() {}, stopPropagation() {}, target: this })); }
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
    start() { this.onstart?.(); }
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
    constructor() { worklets.push(this);this.port={onmessage:null,postMessage:()=>this.port.onmessage?.({data:{flushed:true}})}; }
    connect() {} disconnect() {this.disconnected=true;if(options.throwWorkletStop)throw new Error('capture node already closed');}
    frame(rms=0.08,pcm=speechPCM.buffer.slice(speechPCM.byteOffset,speechPCM.byteOffset+speechPCM.byteLength)) {this.port.onmessage?.({data:{rms,pcm}});}
  }
  const storage = new Map(Object.entries(options.storage || {}));
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
    SageAI: { availableKeys: () => options.noKey ? [] : [{ key: 'test-only' }], askSage: options.askSage || (async text => { asks.push(text); return { ok: true, text: 'சரி bro, service history பார்க்கலாம்.' }; }) },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body); requests.push({url,body,signal:init.signal});
      if (body.generationConfig.responseModalities) return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: options.emptyAudio ? 'AAAAAA==' : (options.silentAudio ? Buffer.alloc(speechPCM.length) : speechPCM).toString('base64'), mimeType:'audio/L16;rate=24000' } }] } }] }) };
      if (options.transcribe) return options.transcribe(init);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(options.transcript || { transcript: 'நேத்து petrol போட்டேன் bro', unclear: false }) }] } }] }) };
    }, console,
  };
  root.self = root;
  if (options.live) {root.WebSocket=Socket;root.AudioWorkletNode=Worklet;vm.runInNewContext(liveSource,root,{filename:'sage-transcription.js'});}
  vm.runInNewContext(toolsSource, root, { filename:'sage-tools.js' });
  vm.runInNewContext(source, root, { filename: 'sage-voice.js' });
  return { root, nodes, streams, recordings, recognition, asks, requests, decoded, storage, playback, contexts,sockets,worklets,analysers,animationFrames,
    get history() { return history; },
    tick(ms) { now += ms; [...intervals.values()].forEach(fn => fn()); },
    animate() { const frames=[...animationFrames.values()];animationFrames.clear();frames.forEach(fn=>fn()); },
    async open() { root.SageVoice.open(); await until(() => recordings.length || (options.storage?.sage_voice_recognition === 'browser' && recognition.length)); },
    async finish() { nodes.get('sageVoiceOrb').emit('click'); await until(() => requests.some(r => !r.body.generationConfig.responseModalities)); },
    cleanup() { root.SageVoice.close(); timers.forEach(clearTimeout); }, newStream,
  };
}

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
    assert.equal(h.requests.filter(r=>!r.body.generationConfig.responseModalities).length,1);
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
    assert.equal(h.nodes.get('sageVoiceState').textContent,'I’m listening');
  } finally { h.cleanup(); }
});


test('microphone stays stopped until the audio source actually ends', async () => {
  const h = harness({holdPlayback:true});
  try {
    await h.open();
    const reply = h.root.SageVoice.sendVoiceText('play the reply');
    await until(()=>h.playback.length===1);
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Speaking');
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

test('one mixed-language TTS request starts playback before the stream finishes',async()=>{
  const h=harness({holdPlayback:true,askSage:async()=>({ok:true,text:'சொல்லு டா. Tell me what happened.'})});
  let controller,requests=0;
  const event=(finish=false)=>new TextEncoder().encode('data: '+JSON.stringify({candidates:[{content:{parts:[{inlineData:{data:Buffer.concat([speechPCM,speechPCM]).toString('base64'),mimeType:'audio/L16;rate=24000'}}]},...(finish?{finishReason:'STOP'}:{})}]})+'\n\n');
  try {
    await h.open();
    h.root.fetch=async(url,init)=>{
      requests++;const body=JSON.parse(init.body);
      assert.match(url,/streamGenerateContent/);
      assert.equal(body.generationConfig.speechConfig.voiceConfig.voice,'Kore');
      assert.match(body.contents[0].parts[0].text,/சொல்லு டா/);
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
    assert.equal(h.nodes.get('sageVoiceOverlay').getAttribute('data-recognition'),'gemini');
    assert.match(h.nodes.get('sageVoiceHint').textContent,/Gemini key/);
  } finally { h.cleanup(); }
});


test('audio recognition and a 650ms pause are defaults; careful preferences remain available', async () => {
  const h=harness();
  const careful=harness({storage:{sage_voice_speed:'careful',sage_voice_pause:'patient'}});
  try {
    assert.equal(h.root.SageVoice.settings.pauseMs,650);
    await h.open(); await h.finish();
    assert.match(h.requests[0].url,/gemini-3.5-flash:generateContent/);
    assert.equal(careful.root.SageVoice.settings.pauseMs,1200);
    await careful.open(); await careful.finish();
    assert.match(careful.requests[0].url,/gemini-3.8-flash:generateContent/);
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
test('Viky stays in the visible reply with one speech-only pronunciation in either language',async()=>{
  for(const reply of ['Hello Viky.','சொல்லு, Viky.']) {
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
    assert.equal(first.length,2);assert.match(first[1].url,/gemini-2.5-flash/);
    assert.equal(first[0].body.contents[0].parts[0].inlineData.data,first[1].body.contents[0].parts[0].inlineData.data);
    assert.equal(first[0].body.generationConfig.thinkingConfig.thinkingLevel,'low');
    await h.finish();await until(()=>h.recordings.length===3);
    assert.match(h.requests.filter(r=>!r.body.generationConfig.responseModalities).at(-1).url,/gemini-2.5-flash/);
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
    assert.equal(h.requests.filter(r=>!r.body.generationConfig.responseModalities).length,2);
    assert.equal(h.asks.length,0);assert.equal(h.playback.length,1);
    assert.match(h.nodes.get('sageVoiceLines').children.at(-1).innerHTML,/say it again/);
    assert.equal(h.nodes.has('sageVoiceSTTRetry'),false);assert.equal(h.streams.length,1);
    await delay(30);assert.equal(h.requests.length,3,'no background retry');
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
    assert.equal(h.nodes.has('sageVoiceSTTBrowser'),false);assert.equal(h.recognition.length,0);
  }finally{h.cleanup();}
});
test('quota cooldown allows fresh listening but bounds requests until the key is ready',async()=>{
  const h=harness({transcribe:async()=>sttError(429)});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===3);
    assert.equal(h.requests.filter(r=>!r.body.generationConfig.responseModalities).length,1);
    assert.match(h.nodes.get('sageVoiceHint').textContent,/60 seconds/);
    h.tick(60001);await until(()=>h.recordings.length===4);
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===5);
    assert.equal(h.requests.filter(r=>!r.body.generationConfig.responseModalities).length,2);
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
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Opening microphone…');
    allow(h.newStream());await until(()=>h.recordings.length===1);
    assert.equal(h.contexts.length,1,'meter shares the unlocked context');
    assert.equal(h.nodes.get('sageVoiceState').textContent,'I’m listening');
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
test('Tamil and English use a short constant style and cannot switch models after speaking',async()=>{
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
    await until(()=>h.nodes.get('sageVoiceState').textContent==='Restoring audio…');h.root.SageVoice.close();await pending;
    assert.equal(h.requests.length,1);assert.equal(h.playback.length,0);assert.equal(h.recordings.length,1);
  }finally{h.cleanup();}
});
test('backgrounding during retry does not leave a busy call when returning',async()=>{
  const h=harness({silentAudio:true});try{await h.open();const pending=h.root.SageVoice.sendVoiceText('hello');
    await until(()=>h.nodes.get('sageVoiceState').textContent==='Restoring audio…');
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
test('speaker, style and playback speed stay identical across Tamil and English in one call',async()=>{
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
    await until(()=>h.nodes.get('sageVoiceState').textContent==='I’m listening');
    assert.equal(Buffer.from(ws.sent.find(m=>m.realtimeInput?.audio).realtimeInput.audio.data,'base64').equals(speechPCM),true);
    ws.message({serverContent:{inputTranscription:{text:'Hello, how are you?'}}});
    await until(()=>h.nodes.get('sageVoiceCaption').innerHTML.includes('Hello'));
    h.nodes.get('sageVoiceOrb').emit('click');await until(()=>h.recordings.length===2);
    assert.deepEqual(h.asks,['Hello, how are you?']);assert.equal(h.decoded.length,0);
    assert.equal(h.requests.length,1,'only the spoken reply, no batch transcription');
    assert.equal(h.recognition.length,0);assert.equal(h.sockets.length,2,'next socket is warmed once during reply');
  }finally{h.cleanup();}
});

test('slow first worklet startup visibly waits and submits the whole recording once',async()=>{
  let ready;const h=harness({live:true,loud:true,addModule:()=>new Promise(resolve=>{ready=resolve;})});
  try {await h.open();
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Starting audio…');
    assert.match(h.nodes.get('sageVoiceInstruction').textContent,/mic is recording/);
    h.tick(200);ready();await until(()=>h.worklets.length===1);
    h.worklets[0].frame();await until(()=>h.nodes.get('sageVoiceState').textContent==='I’m listening');
    assert.match(h.nodes.get('sageVoiceInstruction').textContent,/after your pause/);
    await h.finish();await until(()=>h.recordings.length===2);
    assert.equal(h.decoded[0],'first-LAST','late live capture never replaces the complete recording');
    assert.equal(h.asks.length,1);assert.equal(h.requests.filter(r=>!r.body.generationConfig.responseModalities).length,1);
  }finally{h.cleanup();}
});
test('a never-ready worklet falls back visibly instead of keeping startup indefinitely',async()=>{
  const h=harness({live:true,fastTimeouts:true,addModule:()=>new Promise(()=>{})});
  try {await h.open();await until(()=>h.nodes.get('sageVoiceState').textContent==='I’m listening');
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
    await until(()=>h.recordings.length===2);assert.deepEqual(h.asks,['சொல்லு டா']);assert.equal(h.root.SageVoice.isOpen(),true);
  }finally{h.cleanup();}
});
test('late final segments after endpoint arrive before one complete submitted sentence',async()=>{
  const h=harness({live:true,liveEnd:ws=>{
    ws.message({serverContent:{generationComplete:true}});
    setTimeout(()=>ws.message({serverContent:{inputTranscription:{text:' ₹500 tomorrow.'}}}),80);
  }});
  try{await h.open();await until(()=>h.worklets.length===1);
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
  try{await h.open();await until(()=>h.worklets.length===1);
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
    await until(()=>h.recordings.length===2);assert.deepEqual(h.asks,['சொல்லு டா']);
  }finally{h.cleanup();}
});
test('waitingForInput expects more speech and does not end a still-speaking turn',async()=>{
  const h=harness({live:true,loud:true});
  try{await h.open();await until(()=>h.worklets.length===1);
    h.sockets[0].message({serverContent:{inputTranscription:{text:'Hello'},waitingForInput:true}});
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
  try{h.root.SageVoice.open();assert.equal(h.nodes.get('sageVoiceState').textContent,'Opening microphone…');
    assert.equal(h.recognition.length,0);assert.equal(h.nodes.has('sageVoiceReview'),false);assert.equal(h.nodes.has('sageVoiceMethod'),false);
    allow(h.newStream());await until(()=>h.recordings.length===1 && h.worklets.length===1);
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Starting audio…');
    h.worklets[0].frame(0);await until(()=>h.nodes.get('sageVoiceState').textContent==='I’m listening');
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
    h.worklets[0].frame(.04);h.tick(100);h.worklets[0].frame(0);h.tick(100);
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
    h.worklets[0].frame();await until(()=>h.nodes.get('sageVoiceState').textContent==='I’m listening');
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
