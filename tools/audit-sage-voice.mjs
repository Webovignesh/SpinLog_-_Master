// Deterministic voice lifecycle regressions. No API keys, network or database.
// Run: node --test tools/audit-sage-voice.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/js/sage-voice.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 150; i++) { if (check()) return; await delay(10); }
  assert.ok(check(), 'timed out waiting for voice state');
}
function harness(options = {}) {
  const timers = new Set(), intervals = new Map(), nodes = new Map(), streams = [], recordings = [], recognition = [];
  const asks = [], requests = [], decoded = [];
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
    state = 'running';
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 1024, getByteTimeDomainData(data) { data.fill(128); } }; }
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
    Blob, DataView, ArrayBuffer, Uint8Array, Float32Array, AbortController, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    atob: b64 => Buffer.from(b64, 'base64').toString('binary'),
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) },
    setTimeout(fn,ms) { const timer = setTimeout(fn,ms); timers.add(timer); return timer; }, clearTimeout,
    setInterval(fn) { const id = Symbol(); intervals.set(id,fn); return id; }, clearInterval: id => intervals.delete(id),
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, matchMedia: () => ({ matches: true }),
    Date: class extends Date { static now() { return now; } },
    dkReduceMotion: () => true,
    dkCloudStore: { chatHistory: () => history.slice(), setChat: rows => { history = rows; } },
    SageAI: { availableKeys: () => [{ key: 'test-only' }], askSage: options.askSage || (async text => { asks.push(text); return { ok: true, text: 'சரி bro, service history பார்க்கலாம்.' }; }) },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body); requests.push({url,body,signal:init.signal});
      if (body.generationConfig.responseModalities) return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: 'AAAAAA==' } }] } }] }) };
      if (options.transcribe) return options.transcribe(init);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(options.transcript || { transcript: 'நேத்து petrol போட்டேன் bro', unclear: false }) }] } }] }) };
    }, console,
  };
  root.self = root;
  vm.runInNewContext(source, root, { filename: 'sage-voice.js' });
  return { root, nodes, streams, recordings, recognition, asks, requests, decoded, storage,
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

test('silence is discarded without sending bytes to Gemini', async () => {
  const h = harness();
  try {
    await h.open(); h.tick(16000); await delay(20);
    assert.equal(h.requests.length,0);
    assert.equal(h.nodes.get('sageVoiceMic').getAttribute('aria-pressed'),'true');
    assert.equal(h.streams[0].getTracks()[0].enabled,false);
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

test('backgrounding releases microphone and does not auto-reopen', async () => {
  const h = harness();
  try {
    await h.open();
    h.root.document.hidden = true;
    h.root.document.events.visibilitychange.forEach(fn => fn());
    assert.equal(h.root.SageVoice.isOpen(),false);
    assert.equal(h.streams[0].getTracks()[0].readyState,'ended');
  } finally { h.cleanup(); }
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

test('quota errors pause instead of retrying recordings in a loop', async () => {
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
    assert.equal(h.nodes.get('sageVoiceState').textContent,'Listening…');
  } finally { h.cleanup(); }
});
