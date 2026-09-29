// Deterministic voice lifecycle regressions. No API keys, network or database.
// Run: node --test tools/audit-sage-voice.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const speechPCM = Buffer.alloc(4800);
for (let i=0;i<2400;i++) speechPCM.writeInt16LE(Math.round(Math.sin(i / 6) * 5000), i*2);
const source = await readFile(new URL('../src/js/sage-voice.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 150; i++) { if (check()) return; await delay(10); }
  assert.ok(check(), 'timed out waiting for voice state');
}
function harness(options = {}) {
  const timers = new Set(), intervals = new Map(), nodes = new Map(), streams = [], recordings = [], recognition = [];
  const asks = [], requests = [], decoded = [], playback = [];
  let history = [], now = 100000;
  class Element {
    constructor(id = '') { this.id = id; this.children = []; this.events = {}; this.attrs = {}; this.hidden = false; this.value = ''; this.type = ''; this.isConnected = true; this.style = { setProperty() {} }; this.classList = { add() {}, remove() {}, toggle() {} }; }
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
  nodes.get('sageVoiceReview').hidden = true;
  nodes.get('sageVoiceReviewSetting').type = 'checkbox';
  const document = { readyState: 'complete', activeElement: nodes.get('sageChatMic'), hidden: false,
    getElementById: id => nodes.get(id) || null, createElement: () => new Element(),
    events: {}, addEventListener(name,fn) { (this.events[name] ||= []).push(fn); } };
  const track = () => ({ readyState: 'live', enabled: true, stop() { this.readyState = 'ended'; } });
  const newStream = () => { const t = track(); const stream = { getTracks: () => [t] }; streams.push(stream); return stream; };
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm;codecs=opus'; recordings.push(this); }
    start() { this.state = 'recording'; this.ondataavailable?.({ data: new Blob(['first-']) }); }
    stop() { this.state = 'inactive'; setTimeout(() => { this.ondataavailable?.({ data: new Blob(['LAST']) }); this.onstop?.(); }, 0); }
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
    state = options.audioBlocked ? 'suspended' : 'running';
    resume() { return Promise.resolve(); }
    createBuffer(channels,length,rate) { return {duration:length/rate,copyToChannel() {}}; }
    createBufferSource() {
      const source = {playbackRate:{value:1},connect(){},disconnect(){},
        start(){playback.push(source); if (!options.holdPlayback) setTimeout(()=>source.onended?.(),5);},
        stop(){}, end(){source.onended?.();}};
      return source;
    }
    close() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 1024, getByteTimeDomainData(data) { data.fill(options.loud ? 136 : 128); } }; }
    async decodeAudioData(buffer) { decoded.push(Buffer.from(buffer).toString()); return { duration: 0.1 }; }
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
  const storage = new Map(Object.entries(options.storage || {}));
  const root = { document, navigator: { onLine: true, mediaDevices: { getUserMedia: options.getUserMedia || (async () => newStream()) } },
    SpeechRecognition: Recognition, MediaRecorder: Recorder, AudioContext, OfflineAudioContext, Audio, FileReader,
    Blob, DataView, ArrayBuffer, Uint8Array, Float32Array, AbortController, TextDecoder, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    atob: b64 => Buffer.from(b64, 'base64').toString('binary'),
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) },
    setTimeout(fn,ms) { const timer = setTimeout(fn,options.fastRestarts && ms >= 500 && ms <= 3000 ? 0 : ms); timers.add(timer); return timer; }, clearTimeout,
    setInterval(fn) { const id = Symbol(); intervals.set(id,fn); return id; }, clearInterval: id => intervals.delete(id),
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, matchMedia: () => ({ matches: true }),
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
  vm.runInNewContext(source, root, { filename: 'sage-voice.js' });
  return { root, nodes, streams, recordings, recognition, asks, requests, decoded, storage, playback,
    get history() { return history; },
    tick(ms) { now += ms; [...intervals.values()].forEach(fn => fn()); },
    async open() { root.SageVoice.open(); await until(() => recordings.length || recognition.length); },
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

test('unclear words require review and only the corrected transcript reaches Sage', async () => {
  const h = harness({ transcript: { transcript: '5000 petrol', unclear: true } });
  try {
    await h.open(); await h.finish();
    await until(() => !h.nodes.get('sageVoiceReview').hidden);
    assert.equal(h.asks.length,0);
    h.nodes.get('sageVoiceDraft').value = '500 ரூபாய்க்கு petrol போட்டேன்';
    h.nodes.get('sageVoiceReview').emit('submit');
    await until(() => h.asks.length === 1);
    assert.equal(h.asks[0], '500 ரூபாய்க்கு petrol போட்டேன்');
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

test('browser fallback defaults to Tamil and ignores old recognizer events', async () => {
  const h = harness({storage:{sage_voice_recognition:'browser'}});
  try {
    await h.open(); const old = h.recognition[0], late = old.onresult;
    assert.equal(old.lang,'ta-IN');
    h.root.SageVoice.close(); h.root.SageVoice.open();
    const result = [{transcript:'stale',confidence:0.9}];result.isFinal=true;
    late({results:[result],resultIndex:0});
    assert.equal(h.asks.length,0);
    assert.equal(h.recognition.length,2);
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

test('recognition preferences persist from settings controls', () => {
  const h = harness();
  try {
    h.nodes.get('sageVoiceLanguage').value='en-IN';h.nodes.get('sageVoiceLanguage').emit('change');
    h.nodes.get('sageVoiceReviewSetting').checked=true;h.nodes.get('sageVoiceReviewSetting').emit('change');
    assert.equal(h.root.SageVoice.settings.sttLang,'en-IN');
    assert.equal(h.root.SageVoice.settings.review,true);
  } finally { h.cleanup(); }
});

test('browser ending with interim speech asks for review rather than dropping the words', async () => {
  const h = harness({storage:{sage_voice_recognition:'browser'}});
  try {
    await h.open();
    h.recognition[0].result('நாளைக்கு service போகணும்',false);
    h.recognition[0].onend();
    assert.equal(h.nodes.get('sageVoiceReview').hidden,false);
    assert.equal(h.nodes.get('sageVoiceDraft').value,'நாளைக்கு service போகணும்');
    assert.equal(h.asks.length,0);
  } finally { h.cleanup(); }
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

test('quota errors back off without immediately retrying the recording', async () => {
  const h = harness({transcribe: async () => ({ok:false,status:429})});
  try {
    await h.open(); await h.finish(); await delay(20);
    assert.match(h.nodes.get('sageVoiceHint').textContent,/quota/);
    assert.equal(h.recordings.length,1);
    assert.equal(h.requests.length,1);
  } finally { h.cleanup(); }
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
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Sage is speaking');
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
      assert.equal(h.recordings.length,1);
      assert.equal(h.playback.length,0);
      assert.equal(h.nodes.get('sageVoiceReplay').hidden,false);
      assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),option==='audioBlocked'?'true':'false');
      assert.match(h.nodes.get('sageVoiceHint').textContent,/Play reply/);
    } finally { h.cleanup(); }
  });
}

test('one mixed-language TTS request starts playback before the stream finishes',async()=>{
  const h=harness({holdPlayback:true,askSage:async()=>({ok:true,text:'சொல்லு டா. Tell me what happened.'})});
  let controller,requests=0;
  const event=(finish=false)=>new TextEncoder().encode('data: '+JSON.stringify({candidates:[{content:{parts:[{inlineData:{data:speechPCM.toString('base64'),mimeType:'audio/L16;rate=24000'}}]},...(finish?{finishReason:'STOP'}:{})}]})+'\n\n');
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


test('fast recognition and a 900ms pause are defaults; careful preferences remain available', async () => {
  const h=harness();
  const careful=harness({storage:{sage_voice_speed:'careful',sage_voice_pause:'patient'}});
  try {
    assert.equal(h.root.SageVoice.settings.pauseMs,900);
    await h.open(); await h.finish();
    assert.match(h.requests[0].url,/gemini-3.5-flash-lite:generateContent/);
    assert.equal(careful.root.SageVoice.settings.pauseMs,2200);
    await careful.open(); await careful.finish();
    assert.match(careful.requests[0].url,/gemini-3.5-flash:generateContent/);
  } finally {h.cleanup();careful.cleanup();}
});

test('a successful replay clears the failure hint and resumes hands-free listening', async () => {
  const options={silentAudio:true}, h=harness(options);
  try {
    await h.open(); await h.root.SageVoice.sendVoiceText('reply');
    assert.equal(h.nodes.get('sageVoiceReplay').hidden,false);
    options.silentAudio=false;
    h.nodes.get('sageVoiceReplay').emit('click');
    await until(()=>h.playback.length===1);
    await until(()=>h.recordings.length===2);
    assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),'false');
    assert.doesNotMatch(h.nodes.get('sageVoiceHint').textContent,/Play reply/);
    assert.equal(h.nodes.get('sageVoiceReplay').hidden,true);
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

test('browser no-speech timeouts keep rearming beyond the failure retry limit',async()=>{
  const h=harness({fastRestarts:true,storage:{sage_voice_recognition:'browser'}});
  try {
    await h.open();
    for(let i=0;i<7;i++) {
      h.recognition[i].onerror({error:'no-speech'});
      h.recognition[i].onend();
      await until(()=>h.recognition.length===i+2);
    }
    assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),'false');
    assert.equal(h.asks.length,0);
    h.recognition.at(-1).onend();h.root.SageVoice.close();await delay(20);
    assert.equal(h.recognition.length,8);
  } finally {h.cleanup();}
});

test('successful playback retry preserves an explicit manual mute',async()=>{
  const options={silentAudio:true},h=harness(options);
  try {
    await h.open();h.nodes.get('sageVoiceMic').emit('click');
    await h.root.SageVoice.sendVoiceText('reply while muted');
    options.silentAudio=false;h.nodes.get('sageVoiceReplay').emit('click');
    await until(()=>h.playback.length===1);await delay(20);
    assert.equal(h.recordings.length,1);
    assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),'true');
  } finally {h.cleanup();}
});

test('replay stops a manually resumed recording before audio and restarts after it ends',async()=>{
  const options={silentAudio:true,holdPlayback:true,fastRestarts:true},h=harness(options);
  try {
    await h.open();await h.root.SageVoice.sendVoiceText('reply');
    await until(()=>h.recordings.length===2);
    options.silentAudio=false;h.nodes.get('sageVoiceReplay').emit('click');
    await until(()=>h.playback.length===1);
    assert.equal(h.recordings[1].state,'inactive');
    h.playback[0].end();await until(()=>h.recordings.length===3);
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

test('browser short disconnects reconnect beyond four attempts without muting',async()=>{
  const h=harness({fastRestarts:true,storage:{sage_voice_recognition:'browser'}});
  try {await h.open();for(let i=0;i<8;i++){h.recognition.at(-1).onend();await until(()=>h.recognition.length===i+2);}
    assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),'false');
    h.recognition.at(-1).onerror({error:'network'});await until(()=>h.recognition.length===10);
  } finally {h.cleanup();}
});
test('streaming TTS falls back once per session when newer model is unavailable',async()=>{
  const h=harness();let calls=[];
  try {await h.open();const fallback=h.root.fetch;
    h.root.fetch=async(url,init)=>{calls.push(url);if(url.includes('gemini-3.8'))return {ok:false,status:404};return fallback(url,init);};
    await h.root.SageVoice.sendVoiceText('சொல்லு டா');await h.root.SageVoice.sendVoiceText('English reply');
    assert.equal(calls.filter(u=>u.includes('gemini-3.8')).length,1);
    assert.equal(calls.filter(u=>u.includes('gemini-3.1-flash-tts-preview')).length,2);
    assert.ok(h.requests.every(r=>r.body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName==='Kore'));
  } finally {h.cleanup();}
});
test('truncated audio stream offers replay and automatically recovers the mic',async()=>{
  const h=harness({fastRestarts:true});
  try {await h.open();h.root.fetch=async()=>({ok:true,headers:new Headers({'content-type':'text/event-stream'}),
    body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({candidates:[{content:{parts:[{inlineData:{data:speechPCM.toString('base64'),mimeType:'audio/L16;rate=24000'}}]}}]})+'\n\n'));c.close();}})});
    await h.root.SageVoice.sendVoiceText('reply');await until(()=>h.recordings.length===2);
    assert.equal(h.nodes.get('sageVoiceReplay').hidden,false);assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),'false');
  } finally {h.cleanup();}
});

const transcriptResponse = (text='சொல்லு டா') => ({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({transcript:text,unclear:false})}]}}]})});
const sttError = (status,message='unavailable') => ({ok:false,status,json:async()=>({error:{message}})});
test('unavailable recognition model falls back on the same audio and remembers the route',async()=>{
  let calls=0;const h=harness({transcribe:async()=>++calls===1?sttError(404):transcriptResponse()});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    const first=h.requests.filter(r=>!r.body.generationConfig.responseModalities);
    assert.equal(first.length,2);assert.match(first[1].url,/gemini-3.1-flash-lite/);
    assert.equal(first[0].body.contents[0].parts[0].inlineData.data,first[1].body.contents[0].parts[0].inlineData.data);
    assert.equal(first[0].body.generationConfig.thinkingConfig.thinkingLevel,'low');
    await h.finish();await until(()=>h.recordings.length===3);
    assert.match(h.requests.filter(r=>!r.body.generationConfig.responseModalities).at(-1).url,/gemini-3.1-flash-lite/);
  }finally{h.cleanup();}
});
test('unsupported thinking option retries once without it, preserving schema safeguards',async()=>{
  let calls=0;const h=harness({transcribe:async()=>++calls===1?sttError(400,'thinkingLevel is not supported'):transcriptResponse()});
  try {await h.open();await h.finish();await until(()=>h.recordings.length===2);
    assert.equal(h.requests[1].body.generationConfig.thinkingConfig,undefined);
    assert.ok(h.requests[1].body.generationConfig.responseSchema.required.includes('unclear'));
  }finally{h.cleanup();}
});
test('failed recognition never cycles capture; retry reuses saved recording without decoding again',async()=>{
  let failing=true;const h=harness({fastRestarts:true,transcribe:async()=>failing?sttError(503):transcriptResponse()});
  try {await h.open();await h.finish();await until(()=>!h.nodes.get('sageVoiceSTTError').hidden);
    assert.equal(h.requests.length,2);assert.equal(h.recordings.length,1);
    h.tick(10000);await delay(30);assert.equal(h.recordings.length,1);assert.equal(h.asks.length,0);
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Couldn’t transcribe');
    const audio=h.requests[0].body.contents[0].parts[0].inlineData.data;
    failing=false;h.nodes.get('sageVoiceSTTRetry').emit('click');await until(()=>h.recordings.length===2);
    assert.equal(h.decoded.length,1);assert.equal(h.requests[2].body.contents[0].parts[0].inlineData.data,audio);
    assert.equal(h.asks.length,1);assert.equal(h.nodes.get('sageVoiceSTTError').hidden,true);
  }finally{h.cleanup();}
});
test('invalid key shows actionable failure and does not retry unchanged requests',async()=>{
  const h=harness({transcribe:async()=>sttError(400,'API key not valid')});
  try {await h.open();await h.finish();await until(()=>!h.nodes.get('sageVoiceSTTError').hidden);
    assert.equal(h.requests.length,1);assert.match(h.nodes.get('sageVoiceHint').textContent,/key was rejected/);
    h.nodes.get('sageVoiceSTTBrowser').emit('click');await until(()=>h.recognition.length===1);
    assert.equal(h.recognition[0].lang,'ta-IN');assert.equal(h.nodes.get('sageVoiceSTTError').hidden,true);
    assert.equal(h.requests.length,1);
  }finally{h.cleanup();}
});
test('quota recovery honors cooldown and does not record or upload repeatedly',async()=>{
  const h=harness({transcribe:async()=>sttError(429)});
  try {await h.open();await h.finish();await until(()=>!h.nodes.get('sageVoiceSTTError').hidden);
    h.nodes.get('sageVoiceSTTRetry').emit('click');await delay(10);assert.equal(h.requests.length,1);
    assert.match(h.nodes.get('sageVoiceHint').textContent,/60 seconds/);
    h.tick(60001);h.nodes.get('sageVoiceSTTRetry').emit('click');await until(()=>h.requests.length===2);
    assert.equal(h.recordings.length,1);
  }finally{h.cleanup();}
});
test('closing failed recognition clears saved audio and retry cannot upload into new session',async()=>{
  const h=harness({transcribe:async()=>sttError(403,'API_KEY_HTTP_REFERRER_BLOCKED')});
  try {await h.open();await h.finish();await until(()=>!h.nodes.get('sageVoiceSTTError').hidden);
    h.root.SageVoice.close();await h.open();h.nodes.get('sageVoiceSTTRetry').emit('click');await delay(15);
    assert.equal(h.requests.length,1);assert.equal(h.nodes.get('sageVoiceSTTError').hidden,true);
  }finally{h.cleanup();}
});
