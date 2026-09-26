// ════════════════════════════════════════════════════════════════════════
// SPINLOG — SAGE VOICE
//
// Her voice out loud: one orb, hands-free, ChatGPT-voice rhythm. Tap the
// mic, she greets you, you talk, she answers, she listens again.
//
// Three jobs, and the file is split the same way:
//
//   EARS   Two of them. Web Speech recognition runs CONTINUOUS with our own
//          1.8s-quiet endpointing, Tamil adapting between en-IN and ta-IN,
//          and a 500ms supervisor that guarantees the mic — no stall survives
//          it. Where the browser recognition service dies on contact (blocked
//          permission, hardened browsers), Gemini ears take over: a tap-to-talk
//          MediaRecorder capture transcribed VERBATIM by gemini-2.5-flash —
//          street Tanglish included, never cleaned up. Interim results drive
//          the live "you:" caption; the energy gate tells a real utterance
//          apart from room noise.
//   BRAIN  window.SageAI.askSage — the SAME persona, tools and memory as
//          typed chat, with a smaller token ceiling so she starts talking
//          sooner. Every turn lands in the same chat history, untouched in
//          shape: the overlay lines are ephemeral, the conversation is not.
//   MOUTH  Gemini TTS only, through the existing free key ring — one voice,
//          hers. Replies are split into sentences whose audio is fetched IN
//          PARALLEL and played back in order, so a three-sentence answer
//          costs about one sentence of waiting instead of three. Tamil-script
//          replies get a Tamil-spoken prompt; Thanglish gets a Tanglish
//          accent line. Emoji never reach the speaker.
//
// No settings UI anywhere: voice, rate and STT language live in
// localStorage permanently. The overlay is orb + visualiser + captions and
// two buttons, nothing else.
//
// Classic script, one global (window.SageVoice).
// ════════════════════════════════════════════════════════════════════════

(function (root) {
  'use strict';

  // ── Permanent settings (no UI; stored once, kept for good) ────────────
  const LS_GEM_VOICE = 'sage_voice_gem';      // Gemini prebuilt voice
  const LS_RATE = 'sage_voice_rate';
  const LS_STT_LANG = 'sage_voice_lang';      // en-IN | ta-IN, adaptive

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : raw;
    } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, String(value)); } catch { /* private mode */ }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  const settings = {
    get engine() { return 'gemini'; }, // Gemini-only. The ring key is her voice.
    get gemVoice() { return load(LS_GEM_VOICE, 'Kore'); },
    get rate() {
      const n = parseFloat(load(LS_RATE, '1'));
      return Number.isFinite(n) ? Math.min(1.3, Math.max(0.7, n)) : 1;
    },
    get sttLang() { return load(LS_STT_LANG, 'en-IN'); },
    set sttLang(v) { save(LS_STT_LANG, v); },
  };

  // ── State ─────────────────────────────────────────────────────────────
  const S = {
    open: false,
    mode: 'idle',      // idle | listening | thinking | speaking
    session: 0,        // bumped on close; stale async work aborts on mismatch
    muted: false,
    recognising: false,
    speaking: false,   // TTS audio actually playing
    busy: false,       // brain turn in flight
    finalText: '',
    speechSeen: false, // mic energy said a human is talking
    listenSince: 0,
    sttDead: false, // hardware missing / unsupported: supervisor stands down
    sttMode: 'web', // web | gemini — Gemini ears when the browser ear is blocked
    micDead: false, // web ear tripped the death guard; next mic tap retries fresh
    recording: false, // MediaRecorder running (Gemini-ears mode)
    lastSaid: null, // last reply, kept when audio failed so tapping her retries it
    lastMicErr: '', // exact getUserMedia failure name — the mic's own words
    devCount: null, // input devices the browser admits to (needs no permission)
    lastFocus: null,
  };

  function $(id) { return document.getElementById(id); }
  function els() {
    return {
      overlay: $('sageVoiceOverlay'),
      orb: $('sageVoiceOrb'),
      bars: $('sageVoiceBars'),
      state: $('sageVoiceState'),
      caption: $('sageVoiceCaption'),
      lines: $('sageVoiceLines'),
      mic: $('sageVoiceMic'),
      end: $('sageVoiceEnd'),
      close: $('sageVoiceClose'),
      hint: $('sageVoiceHint'),
    };
  }

  const TAMIL_SCRIPT = /[\u0B80-\u0BFF]/;

  function RecognitionCtor() {
    return root.SpeechRecognition || root.webkitSpeechRecognition || null;
  }
  function sttSupported() { return !!RecognitionCtor(); }

  // ── Text for the mouth ────────────────────────────────────────────────
  function speakable(text) {
    let out = String(text || '');
    out = out.replace(/```[\s\S]*?```/g, ' ');
    out = out.replace(/[*_~`#>|]/g, '');
    out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    out = out.replace(/\p{Extended_Pictographic}/gu, '');
    out = out.replace(/₹/g, ' rupees ');
    out = out.replace(/\s*\n+\s*/g, '. ');
    out = out.replace(/[ \t]{2,}/g, ' ').trim();
    return out;
  }

  // ── Audio unlock ──────────────────────────────────────────────────────
  // <audio> playback can stay blocked until a user gesture "allows" sound —
  // and a slow brain turn can outlast that gesture, muting her reply with
  // play-blocked. So the tap does three synchronous things: resume the
  // shared context, resume the meter context, and play a silent blip through
  // a real <audio> element, warming the exact pipeline her replies use.
  let actx = null;
  let unlockUrl = null;

  function silentClipUrl() {
    if (unlockUrl) return unlockUrl;
    try {
      const len = 2400; // 0.1s of silence at 24kHz mono 16-bit
      const buf = new ArrayBuffer(44 + len);
      const v = new DataView(buf);
      const ws = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
      ws(0, 'RIFF'); v.setUint32(4, 36 + len, true); ws(8, 'WAVE'); ws(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, 24000, true); v.setUint32(28, 48000, true);
      v.setUint16(32, 2, true); v.setUint16(34, 16, true); ws(36, 'data');
      v.setUint32(40, len, true);
      unlockUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    } catch { /* no blob URLs here */ }
    return unlockUrl;
  }

  function unlockAudio() {
    try {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      if (!actx) actx = new AC();
      if (actx.state === 'suspended') actx.resume().catch(() => {});
    } catch { /* no WebAudio here */ }
    // The meter context suspends the same way — a suspended Analyser reads
    // all zeros, so voice-detection would never trip and every take would be
    // discarded as "heard nothing". Same gesture, same fix.
    try {
      if (typeof meterCtx !== 'undefined' && meterCtx && meterCtx.state === 'suspended') {
        meterCtx.resume().catch(() => {});
      }
    } catch { /* ignore */ }
    // And the <audio> pipeline itself, with real silence.
    try {
      const url = silentClipUrl();
      if (url) {
        const a = new Audio(url);
        a.volume = 0;
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
      }
    } catch { /* ignore */ }
  }

  function chunkForSpeech(text) {
    const clean = String(text || '').trim();
    if (!clean) return [];
    const parts = clean.match(/[^.!?…\n]+[.!?…]+["'”’)]?\s*|\S[^.!?…\n]*$/g) || [clean];
    const out = [];
    let buf = '';
    parts.forEach(p => {
      if ((buf + ' ' + p).trim().length > 220) { if (buf.trim()) out.push(buf.trim()); buf = p; }
      else buf = `${buf} ${p}`;
    });
    if (buf.trim()) out.push(buf.trim());
    return out.slice(0, 10);
  }

  // Sentence splitter, shared by the parallel TTS fetch below. One audio
  // request per sentence keeps each one short and reliable; the parallelism
  // is what makes a long answer start talking fast.

  // ════════════════════════════════════════════════════════════════════
  // MOUTH — Gemini TTS through the existing key ring
  // ════════════════════════════════════════════════════════════════════
  const GEM_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
  const GEM_TTS_RATE = 24000;

  let gemAudio = null;
  let gemSettle = null; // resolve of the in-flight Gemini line, if any

  function gemKey() {
    const AI = root.SageAI;
    if (!AI) return '';
    try {
      if (AI.availableKeys) {
        const list = AI.availableKeys();
        if (list && list.length) return list[0].key;
      }
      if (AI.getKeys) {
        const list = AI.getKeys();
        if (list && list.length) return list[0].key;
      }
    } catch { /* ignore */ }
    return '';
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function pcmToWavUrl(pcm, rate) {
    const len = pcm.length;
    const buf = new ArrayBuffer(44 + len);
    const v = new DataView(buf);
    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    v.setUint32(4, 36 + len, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    writeStr(36, 'data');
    v.setUint32(40, len, true);
    new Uint8Array(buf, 44).set(pcm);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  function stopGemini() {
    // pause() fires neither ended nor error, so a cut-off line would hang its
    // promise (and the whole loop with it) for ever. Settle it by hand.
    const settle = gemSettle;
    gemSettle = null;
    try { if (gemAudio) { gemAudio.pause(); gemAudio.removeAttribute('src'); } }
    catch { /* ignore */ }
    gemAudio = null;
    if (settle) {
      try { settle(false); } catch { /* ignore */ }
    }
  }

  /**
   * ONE identity, every language, every sentence. Branching the style per
   * text ("speak Tamil" vs "Tanglish accent") is what made her sound like
   * two different people — and per-sentence calls already drift prosody, so
   * the only thing holding her together is a fixed direction. Same woman in
   * Tamil, English and Tanglish; the words carry the language, not her.
   */
  const GEM_VOICE_STYLE =
    'Speak in one consistent voice: a warm young Indian woman talking to someone '
    + 'she likes, natural Tamil-English Tanglish accent, conversational pace, a little '
    + 'playful. Sound like the same person no matter which language the words are in.';

  // One sentence of audio. Never rejects for a dead sentence — a 429 on
  // sentence 3 must skip sentence 3, not kill the whole reply. One retry,
  // because a burst of parallel requests can trip the per-minute limit once.
  async function fetchSentenceAudio(sentence, style, key, my) {
    let firstErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (my !== voiceSession || !S.open) return { url: null };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEM_TTS_MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${style}: ${sentence}` }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.gemVoice || 'Kore' } } },
            },
          }),
        });
        clearTimeout(timer);
        if (res.status === 429) {
          firstErr = firstErr || new Error('quota');
          if (attempt === 0) { await sleep(900); continue; }
          return { url: null, error: firstErr };
        }
        if (!res.ok) return { url: null, error: new Error(`tts-${res.status}`) };
        const json = await res.json();
        const parts = (json && json.candidates && json.candidates[0]
          && json.candidates[0].content && json.candidates[0].content.parts) || [];
        const inline = parts.map(p => p && p.inlineData).find(d => d && d.data);
        if (!inline) return { url: null, error: new Error('no-audio') };
        const url = pcmToWavUrl(base64ToBytes(inline.data), GEM_TTS_RATE);
        if (my !== voiceSession || !S.open) {
          try { URL.revokeObjectURL(url); } catch { /* ignore */ }
          return { url: null };
        }
        return { url };
      } catch (err) {
        clearTimeout(timer);
        const wrapped = err && err.name === 'AbortError' ? new Error('timeout') : err;
        firstErr = firstErr || wrapped;
        if (attempt === 0 && S.open && my === voiceSession) { await sleep(700); continue; }
        return { url: null, error: firstErr };
      }
    }
    return { url: null, error: firstErr };
  }

  /** N items through fn, at most `n` in flight. Results stay in order. */
  async function mapPool(items, n, fn) {
    const out = new Array(items.length).fill(null);
    let at = 0;
    const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
      while (at < items.length) {
        const i = at++;
        out[i] = await fn(i);
      }
    });
    await Promise.all(workers);
    return out;
  }

  function playOneUrl(url, my) {
    return new Promise((resolve, reject) => {
      stopGemini(); // clears any previous line (settles it by hand)
      if (my !== voiceSession || !S.open) return resolve(false);
      const audio = new Audio(url);
      gemAudio = audio;
      gemSettle = value => {
        gemSettle = null;
        if (gemAudio === audio) gemAudio = null;
        resolve(value);
      };
      audio.playbackRate = settings.rate;
      audio.onended = () => {
        const s = gemSettle;
        gemSettle = null;
        if (gemAudio === audio) gemAudio = null;
        if (s) s(true); else resolve(true);
      };
      audio.onerror = () => { gemSettle = null; reject(new Error('play-failed')); };
      const play = audio.play();
      if (play && play.catch) play.catch(() => { gemSettle = null; reject(new Error('play-blocked')); });
    });
  }

  function dropUrls(results) {
    (results || []).forEach(r => {
      if (r && r.url) { try { URL.revokeObjectURL(r.url); } catch { /* ignore */ } }
    });
  }

  /**
   * The speed workaround: every sentence fetches at once (3 in flight), and
   * sentence 1 starts playing the moment IT lands — the rest arrive while it
   * talks. A 3-sentence answer costs ~1 sentence of waiting, not 3.
   */
  async function speakGeminiParallel(text, my) {
    const sentences = chunkForSpeech(speakable(text)).slice(0, 6);
    if (!sentences.length) return false;
    const key = gemKey();
    if (!key) throw new Error('no-key');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
    const style = GEM_VOICE_STYLE;

    // One full pass: fetch (2 in flight — kinder to the per-minute quota
    // than 3) and play in order. A second pass runs only on TOTAL failure,
    // so a lone dead sentence never doubles the quota burn.
    const runOnce = async () => {
      const results = new Array(sentences.length).fill(null);
      const fetching = mapPool(sentences, 2, async i => {
        results[i] = await fetchSentenceAudio(sentences[i], style, key, my);
      });

      let playedAny = false;
      let firstErr = null;
      for (let i = 0; i < sentences.length; i++) {
        while (results[i] === null) {
          if (my !== voiceSession || !S.open) { dropUrls(results); return { playedAny, firstErr }; }
          await sleep(120);
        }
        const r = results[i];
        if (!r.url) {
          if (r.error && !firstErr) firstErr = r.error;
          continue; // a dead sentence is skipped, not fatal
        }
        if (my !== voiceSession || !S.open) { dropUrls(results); return { playedAny, firstErr }; }
        try {
          if (await playOneUrl(r.url, my)) playedAny = true;
        } catch (err) {
          if (!firstErr) firstErr = err;
          try { URL.revokeObjectURL(r.url); } catch { /* ignore */ }
          // A blocked play means the device refuses audio — no point trying more.
          if (err && (err.message === 'play-blocked' || err.message === 'play-failed')) break;
          continue;
        }
        try { URL.revokeObjectURL(r.url); } catch { /* ignore */ }
        if (my !== voiceSession || !S.open) return { playedAny, firstErr };
      }
      await fetching;
      dropUrls(results);
      return { playedAny, firstErr };
    };

    let out = await runOnce();
    // Second chance: quota windows and hiccups clear in seconds, and a
    // text-only reply is the worst outcome — silence with words on screen.
    if (!out.playedAny && my === voiceSession && S.open) {
      await sleep(2000);
      if (my === voiceSession && S.open) out = await runOnce();
    }
    if (!out.playedAny) throw out.firstErr || new Error('no-audio');
    return true;
  }

  // Bumped to abort: every fetch and every play checks it and walks away.
  let voiceSession = 0;

  function stopAllAudio() {
    voiceSession++;
    stopGemini();
  }

  async function speak(text) {
    S.speaking = true;
    setMode('speaking');
    const my = ++voiceSession;
    // A stuck line (plays never, fails never) must never wedge the loop:
    // cap it, cut the audio, move on.
    let timer = 0;
    const cap = new Promise(resolve => {
      timer = setTimeout(() => { voiceSession++; stopGemini(); resolve(false); }, 60000);
    });
    try {
      await Promise.race([speakGeminiParallel(text, my), cap]);
      return true;
    } finally {
      clearTimeout(timer);
      S.speaking = false;
    }
  }

  function interrupt() {
    stopAllAudio();
    S.speaking = false;
    if (S.open && !S.busy) {
      setMode('listening');
      startListening();
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // EARS — continuous recognition, our own endpointing, supervisor-healed
  //
  // Single-utterance mode cut him off at the first pause ("auto picking"
  // what he says too early) and every stall stranded the mic. Now the
  // session runs CONTINUOUS, finals accumulate, and a turn ends after 1.8s
  // of quiet following real speech — patient with natural pauses, quick
  // enough to feel live. A 500ms supervisor guarantees the mic: whenever
  // the room is open, unmuted, un-busy and silent, recognition IS running,
  // whatever happened before. No stall can survive it.
  // ════════════════════════════════════════════════════════════════════
  const END_SILENCE_MS = 1800;

  let rec = null;
  let endTimer = null;
  let langTimer = null;
  let superTimer = 0;
  let restarts = 0;
  let lastRestartAt = 0;

  function clearEnd() {
    if (endTimer) { clearTimeout(endTimer); endTimer = null; }
  }
  function clearLangWatch() {
    if (langTimer) { clearTimeout(langTimer); langTimer = null; }
  }

  function otherLang(lang) {
    return String(lang || '').toLowerCase().startsWith('ta') ? 'en-IN' : 'ta-IN';
  }

  /** The quiet after speech is the end of the turn — submit what gathered. */
  function endpointNow() {
    endTimer = null;
    if (!S.open || S.busy || S.muted || S.mode !== 'listening') return;
    const said = S.finalText.trim();
    S.finalText = '';
    S.speechSeen = false;
    paintCaption('', false);
    // The gate: words with no voice behind them are room noise, not a turn.
    if (said && said.length > 1) {
      sendVoiceText(said);
    }
  }

  function armEndpoint() {
    clearEnd();
    endTimer = setTimeout(endpointNow, END_SILENCE_MS);
  }

  function buildRecognizer(lang) {
    const Ctor = RecognitionCtor();
    if (!Ctor) return null;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.lang = lang || settings.sttLang || 'en-IN';

    r.onstart = () => { S.recognising = true; restarts = 0; };
    r.onend = () => {
      S.recognising = false;
      clearEnd();
      clearLangWatch();
      // The supervisor below re-opens the mic when it should be open; this
      // handler only settles a turn the session itself already finished.
      if (!S.open || S.busy || S.muted || S.sttDead || S.mode !== 'listening') return;
      const said = S.finalText.trim();
      if (said) {
        try {
          if (r.lang && r.lang !== settings.sttLang) settings.sttLang = r.lang;
        } catch { /* ignore */ }
        S.finalText = '';
        S.speechSeen = false;
        paintCaption('', false);
        sendVoiceText(said);
      }
    };
    r.onerror = ev => {
      const kind = ev && ev.error;
      if (kind === 'not-allowed' || kind === 'service-not-allowed') {
        S.muted = true;
        paintMic();
        setHint('Mic blocked — allow the microphone, then tap the mic.');
        setMode('idle');
      } else if (kind === 'audio-capture') {
        S.sttDead = true;
        setHint('No microphone found on this device.');
        setMode('idle');
      } else if (kind === 'language-not-supported') {
        // The adapted language is gone on this browser — fall back, forever.
        try { settings.sttLang = otherLang(r.lang); } catch { /* ignore */ }
      } else if (kind === 'network') {
        setHint('Voice recognition needs the network — check connection.');
      }
      // no-speech / aborted resolve through onend + supervisor.
    };
    r.onresult = ev => {
      if (!S.open || S.mode !== 'listening' || S.busy || S.muted) return;
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const said = res[0] ? res[0].transcript : '';
        if (res.isFinal) S.finalText += `${said} `;
        else interim += said;
      }
      paintCaption(S.finalText + interim, true);
      pokeOrb(0.6);
      armEndpoint(); // every word restarts the 1.8s patience
    };
    return r;
  }

  /**
   * The mic, guaranteed. Guards are on the speaking/busy FLAGS, never on the
   * mode label — refusing on a stale label is what stranded her after every
   * answer. Called directly AND every 500ms by the supervisor, so any stall
   * (failed start, dropped session, wedged flag) heals itself unnoticed.
   */
  function startListening(lang) {
    // Gemini ears are tap-to-talk: the supervisor and the tails below route
    // here, and recording starts instead of recognition.
    if (S.sttMode === 'gemini') return startGeminiListen();
    if (!S.open || S.busy || S.muted || S.speaking || S.sttDead) return false;
    if (!RecognitionCtor()) {
      S.sttDead = true;
      setHint('This browser cannot listen — type to her instead.');
      return false;
    }
    try { if (rec && S.recognising) return true; } catch { /* ignore */ }
    // Rapid death loop guard: five instant onends in a row means the engine
    // itself is broken, not quiet — diagnose and fall over to Gemini ears.
    const now = Date.now();
    if (now - lastRestartAt < 900) {
      restarts++;
      if (restarts > 5) {
        enterFallbackEar();
        return false;
      }
    } else restarts = 0;
    lastRestartAt = now;
    try {
      const useLang = lang || settings.sttLang || 'en-IN';
      rec = buildRecognizer(useLang);
      if (!rec) return false;
      S.finalText = '';
      S.speechSeen = false;
      S.listenSince = Date.now();
      setMode('listening');
      rec.start();
      startSupervisor();
      // Voice with no words for 12s in the wrong language: try the other
      // one once, then leave whichever works as the remembered default.
      clearLangWatch();
      langTimer = setTimeout(() => {
        if (!S.open || S.busy || S.muted || S.mode !== 'listening') return;
        if (S.speechSeen && !S.finalText.trim()) {
          try { settings.sttLang = otherLang(useLang); } catch { /* ignore */ }
          try { if (rec) rec.stop(); } catch { /* supervisor restarts */ }
        }
      }, 12000);
      return true;
    } catch {
      // start() while the previous session tears down throws — the mode is
      // honest and the supervisor below heals it within half a second.
      setMode('listening');
      startSupervisor();
      return true;
    }
  }

  function stopListening() {
    clearEnd();
    clearLangWatch();
    stopSupervisor();
    if (S.recording) cancelGeminiListen(true);
    try { if (rec && S.recognising) rec.stop(); } catch { /* ignore */ }
    S.recognising = false;
  }

  /**
   * The web ear died on this setup (blocked permission, a browser that kills
   * the recognition service, no service route). Name the cause when the
   * browser admits it; otherwise switch ears instead of stranding her:
   * Gemini transcription hears Tamil and English alike over the same keys.
   */
  async function enterFallbackEar() {
    stopSupervisor();
    try { if (rec && S.recognising) rec.stop(); } catch { /* ignore */ }
    S.recognising = false;
    setMode('idle');
    // The supervisor is already stopped above, so a hanging await here would
    // brick the room (web ear dead, fallback never set). Leash it.
    let blocked = false;
    try {
      const perm = navigator.permissions
        ? await Promise.race([
          navigator.permissions.query({ name: 'microphone' }),
          sleep(3000).then(() => null),
        ])
        : null;
      if (perm && perm.state === 'denied') blocked = true;
    } catch { /* unknowable — fall through to the ears switch */ }
    if (blocked) {
      S.micDead = true;
      S.muted = true;
      paintMic();
      setHint('Mic is blocked for this site — allow it in the address bar, then tap the mic.');
      return;
    }
    if (gemKey()) {
      S.sttMode = 'gemini';
      S.micDead = true;
      S.muted = false;
      paintMic();
      setHint('Web voice is blocked here — Gemini ears on instead. Tap the mic and talk.');
      return;
    }
    S.micDead = true;
    setHint('The mic keeps dropping — tap the mic button to retry.');
    paintMic();
  }

  // ════════════════════════════════════════════════════════════════════
  // EARS II — Gemini transcription (record, then read)
  //
  // For setups where the browser recognition service dies instantly: a
  // short MediaRecorder capture goes to gemini-2.0-flash, which returns
  // only the transcription. Tap-to-talk by nature — tap mic/orb to record,
  // quiet for 2s (or tap again) to send. Same brain path after that.
  // ════════════════════════════════════════════════════════════════════
  // 2.5-flash hears colloquial speech far better than 2.0 — and the prompt
  // below is the other half: formal transcription models "clean up" street
  // Tamil into textbook sentences and drop the exact words he said.
  const GEM_STT_MODEL = 'gemini-2.5-flash';
  const GEM_API = 'https://generativelanguage.googleapis.com/v1beta';

  let mediaRec = null;
  let recChunks = [];
  let recBytes = 0; // captured bytes — the backstop when the meter is asleep
  let recVadTimer = 0;
  let recCapTimer = 0;
  let recHeard = false;
  let recQuietSince = 0;
  let recLoudSince = 0;
  let recStartAt = 0;
  let recLastSec = -1;
  let recStream = null; // our own capture when the meter has none
  let recDone = false;

  function pickRecMime() {
    const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    try {
      if (root.MediaRecorder) {
        for (const c of cands) {
          try { if (MediaRecorder.isTypeSupported(c)) return c; } catch { /* try next */ }
        }
      }
    } catch { /* ignore */ }
    return '';
  }

  function clearRecTimers() {
    if (recVadTimer) { clearInterval(recVadTimer); recVadTimer = null; }
    if (recCapTimer) { clearTimeout(recCapTimer); recCapTimer = null; }
  }

  /**
   * getUserMedia with a leash. A bare await is a brick: on some setups the
   * promise neither resolves nor rejects (allowed-but-no-device), leaving no
   * stream AND no error for ever. Past 8s it is a named failure instead.
   */
  function micStream(timeoutMs) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        const err = new Error('mic-timeout');
        err.name = 'mic-timeout';
        reject(err);
      }, timeoutMs || 8000);
      navigator.mediaDevices.getUserMedia({ audio: true }).then(
        stream => {
          if (done) { try { stream.getTracks().forEach(t => t.stop()); } catch { /* ignore */ } return; }
          done = true;
          clearTimeout(timer);
          resolve(stream);
        },
        err => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  /** How many input devices the browser admits to — no permission needed. */
  function refreshDevCount() {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices().then(list => {
          try {
            S.devCount = (list || []).filter(d => d && d.kind === 'audioinput').length;
          } catch { /* ignore */ }
        }).catch(() => {});
      }
    } catch { /* ignore */ }
  }

  /**
   * Same census, awaited with its own leash. A browser with zero input
   * devices must never reach getUserMedia — on some builds the request
   * pends for ever instead of rejecting, which is exactly the stuck
   * "Opening the recorder…" state. -1 means unknowable; only a hard 0
   * short-circuits.
   */
  function audioInputCount(timeoutMs) {
    return new Promise(resolve => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(-1);
      }, timeoutMs || 2500);
      try {
        navigator.mediaDevices.enumerateDevices().then(
          list => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try {
              resolve((list || []).filter(d => d && d.kind === 'audioinput').length);
            } catch { resolve(-1); }
          },
          () => { if (done) return; done = true; clearTimeout(timer); resolve(-1); }
        );
      } catch {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(-1);
      }
    });
  }

  async function recCaptureStream() {
    if (meterStream) return meterStream;
    try {
      const n = await audioInputCount(2500);
      S.devCount = n === -1 ? S.devCount : n;
      if (n === 0) {
        const none = new Error('no-input');
        none.name = 'no-input';
        throw none;
      }
      const stream = await micStream(8000);
      recStream = stream;
      S.lastMicErr = '';
      return stream;
    } catch (err) {
      S.lastMicErr = (err && err.name) || 'failed';
      throw err;
    }
  }

  /** The mic's own failure, in words he can act on. */
  function micProblem() {
    switch (S.lastMicErr) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Mic blocked for this page — allow it in the address bar, then tap the mic.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No microphone found — plug one in (or pick it in system settings), then tap again.';
      case 'NotReadableError':
        return 'The mic is busy in another app or tab — free it, then tap again.';
      case 'AbortError':
        return 'The mic request was cut off — tap the mic to try again.';
      case 'mic-timeout':
        return 'The mic never answered — close other tabs using it, reload, and tap again.';
      case 'no-input':
        return 'Browser sees no microphone at all — check Windows sound input, then reload and tap again.';
      case 'no-devices':
        return 'This page cannot reach any microphone — type to her instead.';
      default:
        return S.lastMicErr
          ? `Mic error (${S.lastMicErr}) — tap the mic to retry.`
          : 'Mic blocked — allow the microphone, then tap the mic.';
    }
  }

  function startGeminiListen() {
    // No silent exits in here: every refusal names itself on screen, because
    // a tap that does nothing and says nothing is undebuggable.
    if (!S.open) return false;
    if (S.busy) { setHint('Still working — one sec…'); return false; }
    if (S.speaking) return false; // cut her off via the orb instead
    if (S.recording) { finishGeminiListen(true); return true; }
    if (!root.MediaRecorder || !navigator.mediaDevices) {
      setHint('Recording is not supported in this browser — type to her instead.');
      return false;
    }
    const key = gemKey();
    if (!key) {
      setHint('Her ears need a Gemini key — add one in settings.');
      return false;
    }
    refreshDevCount();
    setHint('Opening the recorder…');
    recCaptureStream().then(stream => {
      if (!S.open || S.busy || S.speaking || S.recording) {
        if (stream !== meterStream) stream.getTracks().forEach(t => t.stop());
        return;
      }
      const hook = r => {
        r.ondataavailable = ev => {
          if (ev.data && ev.data.size) { recChunks.push(ev.data); recBytes += ev.data.size; }
        };
        r.onstop = () => { finishGeminiListen(true); };
        r.onerror = () => {
          cancelGeminiListen(false);
          if (S.open) { setMode('idle'); setHint('Recorder fault — tap the mic to try again.'); }
        };
      };
      const mime = pickRecMime();
      try {
        mediaRec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        hook(mediaRec);
      } catch {
        setHint('Could not open the recorder on this device.');
        setMode('idle');
        return;
      }
      recChunks = [];
      recBytes = 0;
      recDone = false;
      recHeard = false;
      recQuietSince = 0;
      recLoudSince = 0;
      recStartAt = Date.now();
      recLastSec = -1;
      try {
        mediaRec.start(250);
      } catch {
        // Some builds reject the mimeType or the timeslice — retry bare.
        try {
          mediaRec = new MediaRecorder(stream);
          hook(mediaRec);
          mediaRec.start();
        } catch {
          setHint('The recorder would not start here — type to her instead.');
          setMode('idle');
          return;
        }
      }
      S.recording = true;
      S.finalText = '';
      setMode('listening', 'Recording… tap to send');
      paintCaption('listening…', false);
      paintMic();
      // Voice-activity stop: heard voice, then 2s of quiet. Tap finishes
      // early; 20s caps the turn either way.
      clearRecTimers();
      recVadTimer = setInterval(() => {
        if (!S.recording) return;
        // Live counting so a take never looks dead while it captures.
        const sec = Math.floor((Date.now() - recStartAt) / 1000);
        if (sec !== recLastSec) {
          recLastSec = sec;
          paintCaption(`recording ${sec}s — tap to send`, false);
        }
        const loud = meterLevel > 0.12;
        if (loud) {
          if (!recLoudSince) recLoudSince = Date.now();
          if (Date.now() - recLoudSince > 200) { recHeard = true; recQuietSince = 0; }
        } else {
          recLoudSince = 0;
          if (recHeard) {
            if (!recQuietSince) recQuietSince = Date.now();
            if (Date.now() - recQuietSince > 2000) finishGeminiListen(true);
          }
        }
      }, 200);
      recCapTimer = setTimeout(() => {
        if (!S.recording) return;
        // Heard voice, or captured real bytes while the meter slept — either
        // way there is something worth transcribing. Only a truly empty take
        // is discarded.
        if (recHeard || recBytes > 8000) finishGeminiListen(true);
        else { cancelGeminiListen(false); setHint('Did not hear anything — tap the mic and try again.'); }
      }, 20000);
    }).catch(() => {
      // recCaptureStream already wrote the exact failure into lastMicErr.
      if (S.lastMicErr === 'NotAllowedError' || S.lastMicErr === 'SecurityError') {
        S.muted = true;
      }
      paintMic();
      setHint(micProblem());
      setMode('idle');
    });
    return true;
  }

  function settleRecorder() {
    clearRecTimers();
    S.recording = false;
    paintMic();
    const r = mediaRec;
    mediaRec = null;
    try { if (r && r.state !== 'inactive') r.stop(); } catch { /* ignore */ }
  }

  function cancelGeminiListen(silent) {
    if (!S.recording && !mediaRec) return;
    recDone = true; // the onstop below must not transcribe
    settleRecorder();
    recChunks = [];
    if (!silent && S.open) {
      setMode('idle');
      paintCaption('', false);
    }
  }

  function finishGeminiListen(commit) {
    if (!S.recording && !recChunks.length) return;
    if (recDone) return;
    recDone = true;
    const chunks = recChunks.slice();
    recChunks = [];
    settleRecorder();
    if (!S.open || S.busy) return;
    if (!commit || !chunks.length) {
      setMode('idle');
      paintCaption('', false);
      startListening();
      return;
    }
    const type = (chunks[0] && chunks[0].type) || pickRecMime() || 'audio/webm';
    const blob = new Blob(chunks, { type });
    if (!blob.size) {
      setMode('idle');
      setHint('That recording came back empty — tap the mic and try again.');
      return;
    }
    setMode('thinking');
    paintCaption('', false);
    setActivityRaw('fa-ear-listen', 'hearing you out');
    blobToBase64(blob).then(b64 => transcribeWithGemini(b64, type)).then(text => {
      setActivity(null);
      if (!S.open) return;
      const said = String(text || '').trim();
      if (!said) {
        setMode('idle');
        setHint('Did not catch that — tap the mic and say it again.');
        return;
      }
      sendVoiceText(said);
    }).catch(err => {
      setActivity(null);
      if (!S.open) return;
      setMode('idle');
      const m = err && err.message;
      setHint(m === 'quota'
        ? 'Transcription quota ran dry — try again in a bit.'
        : 'Could not hear that — tap the mic and try again.');
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('unreadable'));
        reader.onload = () => {
          const out = String(reader.result || '');
          const comma = out.indexOf(',');
          resolve(comma === -1 ? out : out.slice(comma + 1));
        };
        reader.readAsDataURL(blob);
      } catch (err) { reject(err); }
    });
  }

  async function transcribeWithGemini(b64, mime) {
    const key = gemKey();
    if (!key) throw new Error('no-key');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(`${GEM_API}/models/${GEM_STT_MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ inlineData: { mimeType: mime || 'audio/webm', data: b64 } },
            { text: 'Transcribe the speech VERBATIM. The speaker uses colloquial Chennai Tamil mixed with English (Tanglish) — street words, half-sentences, fillers and all. Write Tamil words as spoken (Tamil script), English words in Latin. Do NOT formalize, do NOT translate anything to English, do NOT drop filler words, do NOT summarize. Reply with ONLY the transcription, no commentary, no quotes.' }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 500 },
        }),
      });
      clearTimeout(timer);
      if (res.status === 429) throw new Error('quota');
      if (!res.ok) throw new Error(`stt-${res.status}`);
      const json = await res.json();
      const parts = (json && json.candidates && json.candidates[0]
        && json.candidates[0].content && json.candidates[0].content.parts) || [];
      return parts.map(p => p.text || '').join('').trim();
    } catch (err) {
      clearTimeout(timer);
      throw err && err.name === 'AbortError' ? new Error('timeout') : err;
    }
  }

  function startSupervisor() {
    stopSupervisor();
    superTimer = setInterval(() => {
      if (!S.open || S.muted || S.sttDead || S.busy || S.speaking) return;
      // Gemini ears are tap-to-talk by nature — never auto-record.
      if (S.sttMode === 'gemini') return;
      if ((S.mode === 'listening' || S.mode === 'idle') && !S.recognising) {
        startListening();
      }
    }, 500);
  }

  function stopSupervisor() {
    if (superTimer) { clearInterval(superTimer); superTimer = 0; }
  }

  // ════════════════════════════════════════════════════════════════════
  // Mic meter — orb visualiser + the energy gate
  // ════════════════════════════════════════════════════════════════════
  let meterCtx = null;
  let meterAnalyser = null;
  let meterStream = null;
  let meterRaf = 0;
  let meterLevel = 0;
  let loudSince = 0;

  async function startMeter() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      S.lastMicErr = 'no-devices';
      return;
    }
    try {
      stopMeter();
      const stream = await micStream(8000);
      if (!S.open) { stream.getTracks().forEach(t => t.stop()); return; }
      meterStream = stream;
      S.lastMicErr = '';
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      meterCtx = new AC();
      // A fresh context boots suspended until a gesture releases it — and a
      // suspended Analyser reads all zeros. open() runs inside the mic-tap
      // gesture, so release it here while that still counts.
      try {
        if (meterCtx.state === 'suspended') meterCtx.resume().catch(() => {});
      } catch { /* unlockAudio retries on every tap */ }
      const src = meterCtx.createMediaStreamSource(stream);
      meterAnalyser = meterCtx.createAnalyser();
      meterAnalyser.fftSize = 512;
      src.connect(meterAnalyser);
      const data = new Uint8Array(meterAnalyser.fftSize);
      const tick = () => {
        if (!S.open) return;
        try {
          meterAnalyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const d = (data[i] - 128) / 128;
            sum += d * d;
          }
          const rms = Math.sqrt(sum / data.length);
          meterLevel = Math.min(1, rms * 3.2);
          // The gate: sustained energy means a human is talking. Finals that
          // arrive with the gate never tripped are room noise, not a turn.
          if (meterLevel > 0.12) {
            if (!loudSince) loudSince = Date.now();
            if (Date.now() - loudSince > 180) S.speechSeen = true;
          } else {
            loudSince = 0;
          }
        } catch { meterLevel = 0; }
        paintLevel(meterLevel);
        meterRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      S.lastMicErr = (err && err.name) || S.lastMicErr || 'failed';
      meterLevel = 0;
    }
  }

  function stopMeter() {
    if (meterRaf) cancelAnimationFrame(meterRaf);
    meterRaf = 0;
    try { meterStream && meterStream.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    meterStream = null;
    try { meterCtx && meterCtx.close(); } catch { /* ignore */ }
    meterCtx = null;
    meterAnalyser = null;
    meterLevel = 0;
    loudSince = 0;
  }

  function pokeOrb(v) {
    const e = els();
    if (e.orb) e.orb.style.setProperty('--sage-voice-hit', String(Math.min(1, Math.max(0, v || 0))));
  }

  function paintLevel(level) {
    const e = els();
    if (!e.orb) return;
    const boost = S.mode === 'speaking' ? 0.45 : 0;
    e.orb.style.setProperty('--sage-voice-level', String(Math.min(1, level + boost).toFixed(3)));
    if (e.bars) {
      const kids = e.bars.children;
      for (let i = 0; i < kids.length; i++) {
        const wobble = 0.25 + 0.75 * Math.abs(Math.sin(Date.now() / 380 + i * 0.7));
        const h = S.mode === 'idle' ? 4 : Math.round(4 + (level * 34 + 4) * wobble);
        kids[i].style.height = `${Math.min(40, h)}px`;
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Overlay: live caption + ephemeral lines
  // ════════════════════════════════════════════════════════════════════
  function setMode(mode, custom) {
    S.mode = mode;
    const e = els();
    if (e.overlay) e.overlay.setAttribute('data-voice-mode', mode);
    if (e.orb) e.orb.setAttribute('data-voice-mode', mode);
    const label = custom || {
      idle: 'Tap the mic to talk',
      listening: 'Listening…',
      thinking: 'Thinking…',
      speaking: 'Speaking… tap orb to cut in',
    }[mode] || 'Voice';
    if (e.state) e.state.textContent = label;
    paintMic();
  }

  function setHint(line) {
    const e = els();
    if (e.hint) e.hint.textContent = line || '';
  }

  /**
   * Ground truth in one line: hold the mic button ~1s and this prints.
   * Every "tap does nothing" report ends here — mode, ear, locks, key,
   * recorder, mic stream liveness, meter level, restart count, app version.
   */
  function diagnose() {
    const bits = [];
    try {
      bits.push('mode=' + S.mode);
      bits.push('ear=' + S.sttMode);
      bits.push('busy=' + (S.busy ? 1 : 0));
      bits.push('spk=' + (S.speaking ? 1 : 0));
      bits.push('rec=' + (S.recording ? 1 : 0));
      bits.push('key=' + (gemKey() ? 1 : 0));
      bits.push('mrec=' + (root.MediaRecorder ? 1 : 0));
      let mic = 'none';
      if (meterStream) {
        try {
          mic = meterStream.getTracks().some(t => t.readyState === 'live') ? 'live' : 'dead';
        } catch { mic = '?'; }
      } else if (recStream) {
        try {
          mic = recStream.getTracks().some(t => t.readyState === 'live') ? 'live' : 'dead';
        } catch { mic = '?'; }
      }
      bits.push('mic=' + mic);
      bits.push('micerr=' + (S.lastMicErr || 'none'));
      bits.push('devs=' + (S.devCount === null || S.devCount === undefined ? '?' : S.devCount));
      bits.push('lvl=' + Number(meterLevel || 0).toFixed(2));
      bits.push('restarts=' + restarts);
      const meta = document.querySelector('meta[name="version"]');
      bits.push('v=' + (meta ? meta.getAttribute('content') : '?'));
    } catch (err) {
      bits.push('diag-err=' + (err && err.message));
    }
    return bits.join(' ');
  }

  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** The live "you: …" line while he talks. Replaced, never stacked. */
  function paintCaption(full, live) {
    const e = els();
    if (!e.caption) return;
    const f = String(full || '').trim();
    if (!f) {
      e.caption.innerHTML = S.mode === 'listening'
        ? '<span class="sage-voice-dim">listening…</span>'
        : '';
      return;
    }
    e.caption.innerHTML = `<span class="sage-voice-you">you · </span>${esc(f.length > 200 ? f.slice(-200) : f)}`
      + (live ? '<span class="sage-voice-caret" aria-hidden="true"></span>' : '');
  }

  /**
   * One ephemeral line: slides up, lingers, fades. The chat log is untouched
   * in shape — turns are written there separately — so these can vanish
   * without losing anything.
   */
  function addLine(who, text) {
    const e = els();
    if (!e.lines || !text) return;
    const div = document.createElement('p');
    div.className = `sage-voice-line ${who === 'you' ? 'is-you' : 'is-her'}`;
    div.innerHTML = `<strong>${who === 'you' ? 'you' : 'sage'}</strong><span>${esc(String(text).slice(0, 240))}</span>`;
    e.lines.appendChild(div);
    while (e.lines.children.length > 3) e.lines.removeChild(e.lines.firstChild);
    setTimeout(() => { div.classList.add('is-gone'); }, 5200);
    setTimeout(() => { div.remove(); }, 6000);
  }

  function paintMic() {
    const e = els();
    if (e.mic) {
      e.mic.classList.toggle('is-off', S.muted && S.sttMode !== 'gemini');
      e.mic.classList.toggle('is-live', !!S.recording);
      e.mic.setAttribute('aria-pressed', String(!S.muted));
      e.mic.innerHTML = `<i class="fas ${(S.muted && S.sttMode !== 'gemini') ? 'fa-microphone-slash' : 'fa-microphone'}" aria-hidden="true"></i>`;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // BRAIN — one voice turn through the normal chat path
  // ════════════════════════════════════════════════════════════════════
  function chatHistory() {
    try {
      if (root.SageUI && root.SageUI.readHistory) return root.SageUI.readHistory();
      if (root.dkCloudStore) return root.dkCloudStore.chatHistory();
    } catch { /* ignore */ }
    return [];
  }

  function pushTurn(turn) {
    try {
      const store = root.dkCloudStore;
      if (!store) return;
      const all = store.chatHistory ? store.chatHistory() : [];
      all.push(turn);
      if (store.setChat) store.setChat(all.slice(-80));
      if (root.SageUI && root.SageUI.renderChat) root.SageUI.renderChat();
    } catch { /* storage full etc. */ }
  }

  function voiceProblem(reason) {
    if (reason === 'no-key') return 'Add a Gemini key in settings so I can answer and speak.';
    if (reason === 'offline') return 'You are offline, so I cannot answer right now.';
    if (reason === 'backoff') return 'All my models are resting. Give me a minute.';
    return 'I went quiet. Say it again?';
  }

  function audioProblem(err) {
    const m = err && err.message;
    if (m === 'no-key') return 'Her voice needs a Gemini key — add one in settings.';
    if (m === 'quota') return 'Her voice quota ran dry — tap her to retry.';
    if (m === 'offline') return 'You are offline, so her voice cannot load.';
    return 'Her voice failed to load — tap her to try again.';
  }

  /**
   * The tool-activity pill: what she is doing inside the site, with her own
   * icon for it — reading service history, checking papers, thinking back.
   * Shown through the whole thinking phase, hidden the moment she answers.
   */
  function setActivityRaw(icon, text) {
    const a = $('sageVoiceActivity');
    const ic = $('sageVoiceActivityIcon');
    const tx = $('sageVoiceActivityText');
    if (!a) return;
    if (!text) { a.hidden = true; return; }
    if (ic) ic.setAttribute('class', `fas ${icon || 'fa-gear'}`);
    if (tx) tx.textContent = text;
    a.hidden = false;
  }

  function setActivity(toolName) {
    if (!toolName) { setActivityRaw(null, null); return; }
    const T = root.SageTools;
    const phrase = T && T.describe ? T.describe(toolName) : 'working on something';
    const glyph = T && T.iconFor ? T.iconFor(toolName) : 'fa-gear';
    setActivityRaw(glyph, `she is ${phrase}`);
  }

  async function sendVoiceText(raw) {
    const said = String(raw || '').trim();
    if (!said || S.busy || !S.open) return;
    const owner = S.session;
    S.busy = true;
    S.finalText = '';
    S.speechSeen = false;
    stopListening();
    setMode('thinking');
    paintCaption('', false);
    addLine('you', said);
    setHint('');
    setActivityRaw('fa-brain', 'thinking');

    const AI = root.SageAI;
    if (!AI) {
      setHint('Sage is not loaded yet.');
      S.busy = false;
      if (S.open && !S.muted && S.sttMode !== 'gemini') startListening();
      return;
    }

    pushTurn({ role: 'user', text: said, at: Date.now(), via: 'voice' });
    try { root.SageMemory && root.SageMemory.noteMessage && root.SageMemory.noteMessage(); } catch { /* ignore */ }

    const history = chatHistory().slice(0, -1).map(t => ({ role: t.role, text: t.text }));
    let result = null;
    try {
      result = await AI.askSage(said, {
        history,
        maxTokens: 450, // spoken replies are short; the ceiling is latency
        onTool: name => {
          if (S.open && owner === S.session) setActivity(name);
        },
      });
    } catch (err) {
      result = { ok: false, reason: 'failed' };
    }

    if (!S.open || owner !== S.session) { S.busy = false; return; }

    if (!result || !result.ok) {
      const line = voiceProblem(result && result.reason);
      setHint(line);
      addLine('her', line);
      setActivity(null);
      S.busy = false;
      S.lastSaid = line;
      await speak(line).then(() => { S.lastSaid = null; }).catch(err => {
        setHint(audioProblem(err));
      });
      if (!S.open || owner !== S.session) { S.busy = false; return; }
      S.busy = false;
      setMode('idle');
      if (S.open && !S.muted && S.sttMode !== 'gemini') startListening();
      return;
    }

    pushTurn({
      role: 'sage', text: result.text, at: Date.now(), via: 'voice',
      learned: result.learned && result.learned.length ? result.learned : undefined,
    });
    try {
      const turns = chatHistory();
      root.SageMemory && root.SageMemory.consolidate && root.SageMemory.consolidate(turns).catch(() => {});
    } catch { /* ignore */ }

    addLine('her', result.text);
    setHint('');
    setActivity(null);
    S.lastSaid = result.text;
    await speak(result.text).then(() => { S.lastSaid = null; }).catch(err => {
      setHint(audioProblem(err));
    });
    if (!S.open || owner !== S.session) { S.busy = false; return; }
    S.busy = false;
    // Hands-free is permanent: she always resumes listening after answering.
    setMode('idle');
    if (S.open && !S.muted && S.sttMode !== 'gemini') startListening();
  }

  // ════════════════════════════════════════════════════════════════════
  // Open / close — straight to listening, no greeting
  // ════════════════════════════════════════════════════════════════════
  function open() {
    const e = els();
    if (!e.overlay) return false;
    if (S.open) return true;
    S.lastFocus = document.activeElement || null;
    S.open = true;
    S.session++;
    S.muted = false;
    S.sttDead = false;
    S.sttMode = 'web'; // the web ear gets first refusal every session
    S.micDead = false;
    S.busy = false;
    S.finalText = '';
    S.speechSeen = false;
    e.overlay.hidden = false;
    requestAnimationFrame(() => e.overlay.classList.add('sl-modal--open'));
    e.overlay.setAttribute('aria-hidden', 'false');
    paintMic();
    paintCaption('', false);
    if (e.lines) e.lines.innerHTML = '';
    setHint('');
    setActivity(null);
    unlockAudio(); // synchronous: this tap is the gesture that allows sound
    refreshDevCount(); // hardware census for the diag line (needs no permission)
    startMeter();
    // Ears open at once — the supervisor keeps them open from here.
    setMode('listening');
    startListening();
    return true;
  }

  function close() {
    const e = els();
    S.open = false;
    S.session++;
    S.busy = false;
    S.speaking = false;
    stopListening();
    stopAllAudio();
    stopMeter();
    try { if (recStream) recStream.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    recStream = null;
    try { if (rec) { rec.onend = null; rec.onerror = null; rec.onresult = null; } } catch { /* ignore */ }
    rec = null;
    clearEnd();
    clearLangWatch();
    S.finalText = '';
    S.speechSeen = false;
    if (e.overlay) {
      e.overlay.classList.remove('sl-modal--open');
      e.overlay.setAttribute('aria-hidden', 'true');
      const hide = () => { try { if (!S.open) e.overlay.hidden = true; } catch { /* ignore */ } };
      if (root.dkReduceMotion && root.dkReduceMotion()) hide();
      else setTimeout(hide, 180);
    }
    setMode('idle');
    try { if (S.lastFocus && S.lastFocus.focus) S.lastFocus.focus({ preventScroll: true }); }
    catch { /* ignore */ }
    S.lastFocus = null;
  }

  function toggle() { return S.open ? (close(), false) : open(); }
  function isOpen() { return S.open; }

  // ════════════════════════════════════════════════════════════════════
  // Wiring — ONE door in: the mic in the composer
  // ════════════════════════════════════════════════════════════════════
  function wire() {
    const e = els();
    const mic = $('sageChatMic');
    if (mic && !mic._sageVoiceWired) {
      mic._sageVoiceWired = true;
      mic.addEventListener('click', () => open());
    }
    if (e.close && !e.close._wired) {
      e.close._wired = true;
      e.close.addEventListener('click', close);
    }
    if (e.end && !e.end._wired) {
      e.end._wired = true;
      e.end.addEventListener('click', close);
    }
    if (e.overlay && !e.overlay._wired) {
      e.overlay._wired = true;
      document.addEventListener('keydown', ev => {
        if (ev.key === 'Escape' && S.open) { ev.stopPropagation(); close(); }
      }, true);
    }
    if (e.orb && !e.orb._wired) {
      e.orb._wired = true;
      // Tap her: cut her off mid-sentence, or hear the blocked line again.
      // Cutting in works even mid-turn (S.busy): the audio stops now and the
      // in-flight speak() unwinds on its own through the token settle, with
      // the turn tail resuming the mic afterwards.
      e.orb.addEventListener('click', () => {
        if (!S.open) return;
        unlockAudio();
        if (S.recording) { finishGeminiListen(true); return; }
        if (S.speaking || S.mode === 'speaking') {
          S.lastSaid = null; // the cut-off line is abandoned, not retried
          stopAllAudio();
          if (!S.busy && !S.muted) { setMode('listening'); startListening(); }
          return;
        }
        if (S.busy) { setHint('Still working — one sec…'); return; }
        if (S.lastSaid) {
          const retry = S.lastSaid;
          S.busy = true;
          setHint('');
          speak(retry).then(() => { S.lastSaid = null; }).catch(err => {
            setHint(audioProblem(err));
          }).then(() => {
            S.busy = false;
            if (!S.open) return;
            setMode('idle');
            if (!S.muted && S.sttMode !== 'gemini') startListening();
          });
          return;
        }
        if (S.mode === 'idle' && !S.muted) startListening();
      });
    }
    if (e.mic && !e.mic._wired) {
      e.mic._wired = true;
      // Hold ~1s: print the diagnostic line instead of acting. A short tap
      // behaves normally — the hold path consumes its own click below.
      let holdTimer = 0;
      const cancelHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; } };
      e.mic.addEventListener('pointerdown', () => {
        cancelHold();
        holdTimer = setTimeout(() => {
          holdTimer = 0;
          S._diagHold = true;
          setHint('diag ' + diagnose());
        }, 650);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(evName =>
        e.mic.addEventListener(evName, cancelHold));
      e.mic.addEventListener('click', () => {
        if (S._diagHold) { S._diagHold = false; return; }
        // Gemini ears: the button is record / finish, not a mute toggle.
        if (S.sttMode === 'gemini') {
          if (S.recording) finishGeminiListen(true);
          else if (!S.busy && !S.speaking) { setHint(''); startGeminiListen(); }
          return;
        }
        // The death trip is a fresh attempt, never a mute toggle — tapping
        // twice to unmute out of a failure is how retries went to die.
        if (S.micDead) {
          S.micDead = false;
          S.muted = false;
          restarts = 0;
          setHint('');
          paintMic();
          startListening();
          return;
        }
        S.muted = !S.muted;
        if (S.muted) { stopListening(); setMode('idle'); setHint('Mic off — tap again to talk.'); }
        else { setHint(''); setMode('listening'); startListening(); }
        paintMic();
      });
    }
    setMode('idle');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }

  root.SageVoice = {
    open, close, toggle, isOpen,
    sttSupported,
    speak, interrupt, startListening, stopListening, sendVoiceText,
    settings,
  };
})(typeof self !== 'undefined' ? self : this);
