// SPINLOG — SAGE VOICE
// English Live transcription with full-audio and browser recovery,
// session-owned microphone lifecycle, and a four-turn voice conversation.
// Audio uses the existing Gemini key. Chat/tools/history share SageAI.
// Recognition preferences live in Sage settings; captions are ephemeral only
// in presentation, while completed turns remain in the normal chat history.

(function (root) {
  'use strict';

  // ── Persisted voice preferences ────────────
  const LS_GEM_VOICE = 'sage_voice_gem';      // Gemini prebuilt voice
  const LS_RATE = 'sage_voice_rate';
  const LS_TTS_MODEL = 'sage_voice_tts_model';

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : raw;
    } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, String(value)); } catch { /* private mode */ }
  }

  const settings = {
    get engine() { return 'gemini'; }, // Gemini-only. The ring key is her voice.
    get gemVoice() { return load(LS_GEM_VOICE, 'Kore'); },
    get rate() {
      const n = parseFloat(load(LS_RATE, '1.08'));
      return Number.isFinite(n) ? Math.min(1.3, Math.max(0.7, n)) : 1;
    },
    get recognition() { return 'gemini'; }, // migrate old browser preferences to audio
    get pauseMs() { return load('sage_voice_pause', 'quick') === 'patient' ? 1200 : 650; },
  };

  // ── State ─────────────────────────────────────────────────────────────
  const S = {
    open: false,
    docked: false,     // presentation only; microphone and speaker keep their session
    mode: 'idle',      // idle | starting | listening | transcribing | thinking | speaking
    session: 0,        // bumped on close; stale async work aborts on mismatch
    muted: false,
    backgrounded: false,
    ttsModel: 'gemini-3.8-flash-lite-tts',
    voiceName: 'Kore',
    voiceRate: 1.08,
    ttsPinned: false, // first successful voice is retained across future calls
    resumeAfterReply: false, // automatic audio hold; never overrides a manual mute
    speaking: false,   // TTS audio actually playing
    transcribing: false,
    recognitionFailed: false,
    busy: false,       // brain turn in flight
    finalText: '',
    speechSeen: false, // mic energy said a human is talking
    sttMode: 'gemini-transcribe', // dedicated English input; fallback never changes TTS
    recording: false, // MediaRecorder running (Gemini-ears mode)
    lastSaid: null, // last reply, kept when audio failed so tapping her retries it
    lastMicErr: '', // exact getUserMedia failure name — the mic's own words
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
      window: $('sageVoiceWindow'),
      hint: $('sageVoiceHint'),
    };
  }


  function audioCaptureSupported() {
    return !!(root.MediaRecorder && navigator.mediaDevices?.getUserMedia
      && (root.AudioContext || root.webkitAudioContext)
      && (root.OfflineAudioContext || root.webkitOfflineAudioContext));
  }
  function sttSupported() { return audioCaptureSupported(); }

  // ── Text for the mouth ────────────────────────────────────────────────
  function plainVoiceText(text) {
    let out = String(text || '');
    out = out.replace(/```[\s\S]*?```/g, ' ');
    out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    out = out.replace(/(^|\n)\s*(?:#{1,6}\s+|>\s*|[-*+]\s+)/g, '$1');
    out = out.replace(/\*\*([^*]+)\*\*|~~([^~]+)~~|`([^`]+)`/g, (_, ...groups) => groups.slice(0,3).find(value => value !== undefined));
    out = out.replace(/(^|[\s(])__([^_]+)__(?=$|[\s.,!?;)])/g, '$1$2');
    out = out.replace(/(^|[\s(])([*_])([^\n*_]+)\2(?=$|[\s.,!?;)])/g, '$1$3');
    out = out.replace(/\p{Extended_Pictographic}/gu, '');
    return out.replace(/[ \t]{2,}/g, ' ').trim();
  }
  function speakable(text) {
    let out = plainVoiceText(text);
    out = out.replace(/₹/g, ' rupees ');
    out = out.replace(/\s*\n+\s*/g, '. ');
    out = out.replace(/[ \t]{2,}/g, ' ').trim();
    // Keep the displayed name Viky. Only the speech transcript gets a phonetic
    // spelling, while the displayed name stays Viky.
    out = out.replace(/\bViky\b/gi, 'Vik-ee');
    return out;
  }

  // One gesture-unlocked Web Audio context owns playback for the entire session.
  // A new HTMLAudioElement per sentence does not inherit another element's unlock.
  let actx = null;
  const playbackSources = new Map();
  let playbackNextAt = 0;
  let cancelSpeech = null;
  let voiceSession = 0;
  const ttsRequests = new Set();
  const TTS_MODELS = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
  const audioKeyRest = new Map();
  // Gemini 3.8 guidance: long identity/accent instructions cause voice drift.
  // The configured speaker carries identity; English replies need no accent direction.
  const GEM_VOICE_STYLE = '';

  function unlockAudio() {
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    try {
      if (!actx || actx.state === 'closed') actx = new AC();
      if (actx.state === 'suspended') actx.resume().catch(() => {});
      if (meterCtx?.state === 'suspended') meterCtx.resume().catch(() => {});
      root.SageTranscription?.prepare(actx);
    } catch { /* playback will report the actual error */ }
  }
  function gemKeys() {
    const AI = root.SageAI;
    if (!AI) return [];
    try {
      const keys = AI.availableKeys?.() || AI.getKeys?.() || [];
      return [...new Set(keys.map(item => item.key).filter(Boolean))];
    } catch { return []; }
  }
  function configuredGemKeys() {
    try { return root.SageAI?.getKeys ? root.SageAI.getKeys() : gemKeys().map(key => ({key})); }
    catch { return []; }
  }
  function unavailableKey() {
    const configured = configuredGemKeys();
    if (!configured.length) return new Error('no-key');
    const rests = root.SageAI?.readBackoff?.()?.keys || {};
    const entries = configured.map(key => rests[key.id]);
    const rejected = entries.every(rest => rest?.kind === 'rejected' && rest.until > Date.now());
    const retryAt = Math.min(...entries.map(rest => rest?.until > Date.now() ? rest.until : Infinity));
    return Object.assign(new Error(rejected ? 'stt-auth' : 'quota'),Number.isFinite(retryAt) ? {retryAt} : {});
  }

  function decodeSpeech(inline, streaming = false) {
    const mime = inline.mimeType || 'audio/L16;rate=24000';
    if (!/^audio\/(?:L16|pcm)(?:;|$)/i.test(mime)) throw new Error('audio-format');
    const rate = Number(mime.match(/rate=(\d+)/i)?.[1] || 24000);
    if (rate < 8000 || rate > 48000) throw new Error('audio-format');
    const raw = inline.pcm || atob(inline.data);
    if (raw.length < (streaming ? 2 : 96) || raw.length % 2) throw new Error('empty-audio');
    const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
    const pcm = new DataView(bytes.buffer);
    let first = -1, last = -1, activeSamples = 0;
    for (let i = 0; i < raw.length / 2; i++) {
      if (Math.abs(pcm.getInt16(i * 2, true)) > 96) { activeSamples++; if (first < 0) first = i; last = i; }
    }
    // A successful HTTP response with silence must never count as a spoken reply.
    const audible = first >= 0 && (streaming || last - first >= rate * 0.02);
    if (!streaming && !audible) throw new Error('silent-audio');
    if (streaming) { first = 0; last = raw.length / 2; }
    first = Math.max(0, first - Math.floor(rate * 0.06));
    last = Math.min(raw.length / 2, last + Math.floor(rate * 0.12));
    const samples = new Float32Array(last - first);
    for (let i = 0; i < samples.length; i++) samples[i] = pcm.getInt16((first + i) * 2, true) / 32768;
    return { samples, rate, audible, activeSamples };
  }

  // One synthesis request per reply. Audio chunks arrive from ONE speaker
  // performance, with the same selected English speaker for every reply.
  async function streamReply(text, my) {
    const clean = speakable(text);
    if (!clean) throw new Error('no-audio');
    // SageAI repairs non-English answer prose before delivery. This final guard
    // also prevents direct callers or stale code from sending Tamil to TTS.
    if ([...clean].some(c => /\p{L}/u.test(c) && !/\p{Script=Latin}/u.test(c))) throw new Error('english-only');
    const keys = gemKeys().filter(k => (audioKeyRest.get(k) || 0) <= Date.now()).slice(0, 2);
    if (!keys.length) throw gemKeys().length ? new Error('quota') : unavailableKey();
    let model = S.ttsModel;
    for (let attempt=0;attempt<keys.length;attempt++) {
      if ((audioKeyRest.get(keys[attempt]) || 0) > Date.now()) {
        if (attempt+1<keys.length) continue;
        throw new Error('quota');
      }
      const controller = new AbortController();
      ttsRequests.add(controller);
      let timer;
      const watchdog = () => { clearTimeout(timer); timer=setTimeout(()=>controller.abort(),20000); };
      const playback = [], pendingAudio = [];
      let audible = false, started = false, playbackError = null;
      let pendingDuration = 0, sampleRate = 0, activeSamples = 0, carry = '';
      const flush = () => {
        if (!pendingAudio.length || !audible || !S.open || my !== voiceSession) return;
        // Coalesce tiny transport chunks, preserving every PCM sample. Start
        // with 120ms buffered, then schedule arrivals ahead on the audio clock.
        const samples = new Float32Array(pendingAudio.reduce((n,a) => n+a.samples.length, 0));
        let offset = 0;
        for (const audio of pendingAudio) { samples.set(audio.samples, offset); offset += audio.samples.length; }
        pendingAudio.length = 0; pendingDuration = 0;
        started = true;
        playback.push(playSpeech({samples, rate:sampleRate}, my).catch(err => {
          playbackError = err; controller.abort(); stopPlayback(); return false;
        }));
      };
      const queue = inline => {
        const rate = Number((inline.mimeType || '').match(/rate=(\d+)/i)?.[1] || 24000);
        if (sampleRate && rate !== sampleRate) throw new Error('audio-format');
        sampleRate = rate;
        // SSE boundaries need not align with a 16-bit sample boundary.
        let pcm = carry + atob(inline.data);
        carry = pcm.length % 2 ? pcm.slice(-1) : '';
        if (carry) pcm = pcm.slice(0,-1);
        if (!pcm.length) return;
        const audio = decodeSpeech({...inline, pcm}, true);
        // One isolated PCM spike is not a spoken reply. Keep short voiced
        // chunks until their cumulative energy passes the silence safeguard.
        if (!activeSamples && !audio.activeSamples) return;
        activeSamples += audio.activeSamples;
        audible = activeSamples >= sampleRate * 0.02;
        pendingAudio.push(audio); pendingDuration += audio.samples.length/audio.rate;
        if (pendingDuration >= 0.12) flush();
      };
      let reader;
      try {
        watchdog();
        const body = {
          contents:[{role:'user',parts:[{text:clean,speech_metadata:{style:GEM_VOICE_STYLE}}]}],
          generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{voice:S.voiceName}},responseFormat:{audio:{mimeType:'AUDIO_L16',sampleRate:24000}}},
        };
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
          method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','x-goog-api-key':keys[attempt]},body:JSON.stringify(body),
        });
        if (!S.open || my !== voiceSession) return false;
        // Another key may have access to this same speaker/model. Retry that
        // route first, preserving the established sound on reopening.
        if ([401,403,404].includes(res.status) && attempt+1<keys.length) continue;
        // Initial setup may choose an accessible model before she has ever
        // spoken. An established voice is never replaced, even on first reply.
        if ([403,404].includes(res.status) && !S.ttsPinned && model === TTS_MODELS[0]) {
          model = S.ttsModel = TTS_MODELS[1]; attempt = -1; continue;
        }
        if (res.status===429) { audioKeyRest.set(keys[attempt],Date.now()+60000); if (attempt+1<keys.length) continue; throw new Error('quota'); }
        if (!res.ok) throw new Error('tts-'+res.status);
        let finished = false;
        const consume = json => {
          if (!S.open || my!==voiceSession) return;
          if (json.error) throw new Error('tts-stream');
          const candidate=json.candidates?.[0];
          for(const part of candidate?.content?.parts || []) if(part.inlineData?.data) queue(part.inlineData);
          if(candidate?.finishReason) {
            if(candidate.finishReason!=='STOP') throw new Error('incomplete-audio');
            finished=true;
          }
        };
        if (res.body?.getReader && res.headers?.get('content-type')?.includes('text/event-stream')) {
          reader=res.body.getReader();
          const decoder=new TextDecoder(); let pending='';
          const event = raw => {
            const data=raw.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');
            if(data && data!=='[DONE]') consume(JSON.parse(data));
          };
          while(true) {
            const {done,value}=await reader.read();
            if(done) {pending+=decoder.decode();break;}
            watchdog();pending+=decoder.decode(value,{stream:true});
            pending=pending.replace(/\r\n/g,'\n');
            let cut;
            while((cut=pending.indexOf('\n\n'))>=0) {
              event(pending.slice(0,cut)); pending=pending.slice(cut+2);
              if (finished) { pending=''; break; }
            }
            // STOP is authoritative. Do not keep the mic waiting for an idle
            // HTTP stream to close after the final audio has already arrived.
            if (finished) break;
          }
          if(pending.trim()) event(pending);
          if(!finished) throw new Error('incomplete-audio');
        } else {
          const json=await res.json();
          for(const part of Array.isArray(json)?json:[json]) consume(part);
        }
        clearTimeout(timer);
        if (carry) throw new Error('incomplete-audio');
        flush();
        if (!started || !audible) throw new Error('silent-audio');
        const completed=(await Promise.all(playback)).every(Boolean);
        if(playbackError) throw playbackError;
        return completed;
      } catch(err) {
        playbackError = playbackError || err;
        controller.abort(); stopPlayback();
        await Promise.all(playback);
        const failure = playbackError || err;
        if (failure.name === 'AbortError') failure.code = 'timeout';
        failure.audioStarted = started;
        throw failure;
      } finally {
        clearTimeout(timer); ttsRequests.delete(controller);
        // Playback, not transport cleanup, owns the speech-to-mic handoff.
        // Some streams never settle cancel() after their final STOP event.
        try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch { /* closed */ }
        controller.abort();
      }
    }
    throw new Error('no-audio');
  }
  function stopPlayback() {
    for (const [source, finish] of [...playbackSources]) {
      source.onended = null;
      try { source.stop(); } catch { /* already ended */ }
      finish(false);
    }
    playbackNextAt = 0;
  }
  let outputAnalyser = null;
  let outputData = null;
  function playbackMeter() {
    if (!outputAnalyser) {
      outputAnalyser = actx.createAnalyser();
      outputAnalyser.fftSize = 1024;
      outputData = new Uint8Array(outputAnalyser.fftSize);
      outputAnalyser.connect(actx.destination);
    }
    return outputAnalyser;
  }
  async function playSpeech(audio, my) {
    if (!actx || actx.state !== 'running') throw new Error('play-blocked');
    if (!S.open || my !== voiceSession) return false;
    const buffer = actx.createBuffer(1, audio.samples.length, audio.rate);
    buffer.copyToChannel(audio.samples, 0);
    const source = actx.createBufferSource();
    source.buffer = buffer;
    const rate = S.voiceRate;
    source.playbackRate.value = rate;
    source.connect(playbackMeter());
    const now = actx.currentTime;
    const startAt = Math.max(now + (playbackNextAt > now ? 0 : 0.08), playbackNextAt);
    const endAt = startAt + buffer.duration/rate;
    playbackNextAt = endAt;
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (played, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        source.onended = null;
        try { source.disconnect(); } catch { /* released */ }
        playbackSources.delete(source);
        error ? reject(error) : resolve(played);
      };
      playbackSources.set(source, finish);
      source.onended = () => finish(true);
      try {
        // Schedule now, never from the previous source's JS onended callback.
        // Contiguous chunks touch sample-for-sample without per-chunk fades.
        source.start(startAt);
        S.ttsPinned = true;
        save(LS_TTS_MODEL, S.ttsModel);
        setMode('speaking');
        timer = setTimeout(() => {
          finish(false, new Error('play-failed'));
          try { source.stop(); } catch { /* stopped */ }
        }, (endAt - now + 5) * 1000);
      } catch { finish(false, new Error('play-failed')); }
    });
  }

  function stopAllAudio() {
    voiceSession++;
    S.speaking = false;
    ttsRequests.forEach(controller => controller.abort());
    ttsRequests.clear();
    stopPlayback();
    if (cancelSpeech) { cancelSpeech(); cancelSpeech = null; }
  }
  async function prepareSpeech(text, my) {
    if (actx && actx.state !== 'running') {
      let timer;
      try {
        await Promise.race([actx.resume(), new Promise(resolve => { timer = setTimeout(resolve, 350); })]);
      } catch { /* A blocked browser still needs the existing orb gesture. */ }
      finally { clearTimeout(timer); }
    }
    if (!S.open || my !== voiceSession) return false;
    if (!actx || actx.state !== 'running') throw new Error('play-blocked');
    return streamReply(text, my);
  }
  async function speak(text) {
    S.speaking = true;
    setMode('thinking', 'Preparing voice…');
    playbackNextAt = 0;
    const my = ++voiceSession;
    let cancel;
    const interrupted = new Promise(resolve => { cancel = () => resolve(false); cancelSpeech = cancel; });
    try {
      return await Promise.race([prepareSpeech(text, my), interrupted]);
    } finally {
      if (cancelSpeech === cancel) cancelSpeech = null;
      if (my === voiceSession) {
        S.speaking = false;
        ttsRequests.forEach(controller => controller.abort());
        ttsRequests.clear();
      }
    }
  }
  function interrupt() {
    stopAllAudio();
    if (S.open && !S.busy && !S.muted) startListening();
  }

  // One capture owner per turn. Stopping waits for MediaRecorder's final data
  // event; closing/muting invalidates every pending permission and transcription.
  const GEM_STT_MODEL = 'gemini-3.5-flash';
  const GEM_API = 'https://generativelanguage.googleapis.com/v1beta';
  let capture = null;
  let captureEpoch = 0;
  let openingMic = false;
  let sttController = null;
  let recognitionNotice = '', recoveryEpisode = '';
  let nativeEnglishFallback = false, nativeRestUntil = 0;
  const sttCooldowns = new Map(); // key-specific; no background retry of old audio
  const sttModelRest = new Map(); // quota/access on one model must not block another
  const liveKeyRest = new Map();
  let sttRoute = null; // remember a working model/configuration for this session
  let meterCtx = null;
  let meterAnalyser = null;
  let meterSource = null;
  let meterData = null;
  let meterStream = null;
  let visualRaf = 0;
  let visualLevel = 0;
  let meterLevel = 0;
  let noiseFloor = 0.004;
  let micPending = null;

  function current(owner) { return S.open && owner === S.session; }
  function canListen() {
    return S.open && !S.backgrounded && !S.muted && !S.busy && !S.speaking && !S.transcribing && !S.recognitionFailed;
  }
  function micProblem() {
    const messages = {
      NotAllowedError: 'Allow microphone access for this site, then tap the mic to retry.',
      SecurityError: 'Microphone access requires HTTPS and permission for this site.',
      NotFoundError: 'No microphone found. Connect one, then tap the mic.',
      NotReadableError: 'Your microphone is busy. Close the other recording app and retry.',
      'mic-timeout': 'The microphone did not respond. Check permission and tap to retry.',
    };
    return messages[S.lastMicErr] || 'Could not open the microphone. Tap the mic to retry.';
  }
  function pauseListening(message) {
    stopListening();
    S.muted = true;
    meterStream?.getTracks().forEach(t => { t.enabled = false; });
    setMode('idle', 'Microphone paused');
    setHint(message);
    paintMic();
  }
  async function startMeter() {
    if (meterStream && meterStream.getTracks().some(t => t.readyState === 'live')) return meterStream;
    if (micPending) return micPending;
    const owner = S.session;
    const task = (async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      let timedOut = false;
      let timer;
      const request = navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1,
      }}).then(stream => {
        if (timedOut || !current(owner)) {
          stream.getTracks().forEach(t => t.stop());
          throw new Error('cancelled');
        }
        return stream;
      });
      let stream;
      try {
        stream = await Promise.race([request, new Promise((_, reject) => {
          timer = setTimeout(() => { timedOut = true; reject(new Error('mic-timeout')); }, 10000);
        })]);
      } finally { clearTimeout(timer); }
      if (!current(owner)) { stream.getTracks().forEach(t => t.stop()); throw new Error('cancelled'); }
      meterStream = stream;
      stream.getTracks().forEach(t => { t.enabled = !S.muted; });
      stream.getTracks().forEach(t => { t.onended = () => {
        if (current(owner)) { pauseListening('Microphone disconnected. Reconnect and tap to retry.'); stopMeter(); }
      }; });
      if (actx) {
        try {
          // Reuse the context unlocked by the opening tap. Creating a second
          // context after awaiting mic permission loses the user activation.
          meterCtx = actx;
          if (meterCtx.state === 'suspended') meterCtx.resume().catch(() => {});
          meterAnalyser = meterCtx.createAnalyser();
          meterAnalyser.fftSize = 1024;
          meterSource = meterCtx.createMediaStreamSource(stream);
          meterSource.connect(meterAnalyser);
          meterData = new Uint8Array(meterAnalyser.fftSize);
          sampleMeter();
        } catch { /* Recording still works; manual send remains available. */ }
      }
      S.lastMicErr = '';
      return stream;
    })();
    micPending = task;
    try { return await task; }
    finally { if (micPending === task) micPending = null; }
  }
  function sampleMeter(learnNoise = true) {
    if (!meterAnalyser || !meterData) return meterLevel;
    meterAnalyser.getByteTimeDomainData(meterData);
    let sum = 0;
    for (const sample of meterData) sum += ((sample - 128) / 128) ** 2;
    meterLevel = Math.sqrt(sum / meterData.length);
    // Learn only quiet background frames, not the user's soft first syllable.
    if (learnNoise && meterLevel < 0.006 && meterLevel < noiseFloor * 1.5) {
      noiseFloor = Math.min(0.004, Math.max(0.0015, noiseFloor * 0.9 + meterLevel * 0.1));
    }
    return meterLevel;
  }
  function stopMeter() {
    const stream = meterStream;
    meterStream = null;
    stream?.getTracks().forEach(t => { t.onended = null; t.stop(); });
    try { meterSource?.disconnect(); meterAnalyser?.disconnect(); } catch { /* released */ }
    meterCtx = meterAnalyser = meterSource = meterData = null;
    micPending = null;
    meterLevel = 0;
    noiseFloor = 0.004;
  }
  function pickRecMime() {
    return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
      .find(type => root.MediaRecorder?.isTypeSupported(type)) || '';
  }
  function startVisualizer() {
    cancelAnimationFrame(visualRaf);
    const owner = S.session;
    const tick = () => {
      if (!current(owner)) { visualRaf = 0; return; }
      let level = 0;
      if (!S.backgrounded && S.recording && !S.muted) {
        // Read fresh audio even when the worklet owns speech detection. The
        // old animation reused meterLevel, which stayed at zero in this path.
        level = sampleMeter(false);
        if (capture && !capture.pcmAt && level > 0.003) capture.prefixSpeech = true;
      } else if (!S.backgrounded && playbackSources.size && outputAnalyser) {
        outputAnalyser.getByteTimeDomainData(outputData);
        for (const sample of outputData) level += ((sample - 128) / 128) ** 2;
        level = Math.sqrt(level / outputData.length);
      }
      const target = Math.min(1, level * 10);
      visualLevel += (target - visualLevel) * (target > visualLevel ? 0.55 : 0.18);
      paintLevel(visualLevel);
      visualRaf = requestAnimationFrame(tick);
    };
    tick();
  }
  function stopVisualizer() {
    cancelAnimationFrame(visualRaf); visualRaf = 0; visualLevel = 0;
    try { outputAnalyser?.disconnect(); } catch { /* released */ }
    outputAnalyser = outputData = null;
    paintLevel(0);
  }
  function startListening() {
    if (!canListen() || openingMic || S.recording) return false;
    return startGeminiListen();
  }
  let warmEars = null;
  let liveDisabled = false;
  function warmRecognition() {
    if (warmEars && !warmEars.available) retireRecognition(warmEars);
    if (nativeEnglishFallback || liveDisabled || !S.open || S.backgrounded || S.muted || warmEars || !root.SageTranscription || !root.WebSocket) return;
    const key = gemKeys().find(k => (liveKeyRest.get(k) || 0) <= Date.now());
    if (!key) return;
    warmEars = root.SageTranscription.connect({key,pauseMs:settings.pauseMs});
    warmEars.key = key;
  }
  function releaseWarmRecognition() { warmEars?.close(); warmEars = null; }
  function retireRecognition(ears) {
    if (!ears) return;
    const code = ears.failure?.message || 'live-unavailable';
    // Transient connection failures can recover in the same call. Access and
    // quota failures try another configured key, with no rapid reconnect loop.
    liveKeyRest.set(ears.key, Date.now() + (/stt-(auth|access|model)/.test(code) ? 300000 : code === 'quota' ? 60000 : 15000));
    ears.close();
    if (warmEars === ears) warmEars = null;
  }
  function keepRecognition(ears) {
    if (!ears?.available || !S.open || S.muted || S.backgrounded) { ears?.close(); return; }
    ears.park();
    if (warmEars && warmEars !== ears) warmEars.close();
    warmEars = ears;
  }
  function bounded(work, ms, code, onTimeout) {
    let timer;
    return Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => { onTimeout?.(); reject(new Error(code)); }, ms);
    })]).finally(() => clearTimeout(timer));
  }
  function isCloseCommand(text) {
    const intent = root.SageTools?.uiIntent(text);
    return intent?.name === 'control_voice' && intent.action === 'close';
  }
  function englishBrowserListener(take) {
    const Recognition = root.SpeechRecognition || root.webkitSpeechRecognition;
    if (!Recognition || Date.now() < nativeRestUntil) return null;
    let recognizer, final = '', unclear = false, active = true, ending = false, resolveEnd, timer, startTimer, restartTimer;
    const valid = () => active && capture === take && current(take.owner) && !take.cancelled;
    const result = () => final.trim() ? {transcript:final.trim(),unclear} : null;
    const finish = () => { clearTimeout(timer); resolveEnd?.(result()); resolveEnd = null; };
    const start = () => {
      take.nativeReady = false;
      clearTimeout(startTimer);
      startTimer = setTimeout(() => {
        if (!valid() || take.nativeReady || ending) return;
        take.nativeFailed = true; nativeRestUntil = Date.now()+60000;
        active = false; try { recognizer.abort(); } catch { /* unavailable */ }
        paintCaptureReadiness(take);
      },2000);
      recognizer.start();
      paintCaptureReadiness(take);
    };
    try {
      recognizer = new Recognition();
      recognizer.lang = 'en-IN'; recognizer.continuous = true;
      recognizer.interimResults = true; recognizer.maxAlternatives = 1;
      recognizer.onstart = () => { clearTimeout(startTimer); if (valid()) { take.nativeReady = true; paintCaptureReadiness(take); } };
      recognizer.onresult = event => {
        if (!valid()) return;
        const committed = [], draft = [];
        unclear = false;
        for (const row of Array.from(event.results || [])) {
          if (!row[0]?.transcript) continue;
          (row.isFinal ? committed : draft).push(row[0].transcript.trim());
          if (row.isFinal && row[0].confidence > 0 && row[0].confidence < .5) unclear = true;
        }
        final = committed.join(' ');
        take.nativeDraft = !!draft.length;
        const text = [...committed,...draft].join(' ');
        if (text) { take.heard = true; take.previewText = text; paintCaption(text,!!draft.length); }
        if (ending && final && !draft.length) {
          clearTimeout(timer); timer = setTimeout(finish,40);
        }
      };
      recognizer.onerror = event => {
        if (!valid()) return;
        // Silence is a normal turn, not a 60-second browser outage.
        if (event?.error === 'no-speech' || event?.error === 'aborted' && ending) return;
        take.nativeReady = false; take.nativeFailed = true; nativeRestUntil = Date.now()+60000;
        clearTimeout(startTimer);
        final = ''; finish(); paintCaptureReadiness(take); // recorded audio remains the fallback
      };
      recognizer.onend = () => {
        if (!valid()) return;
        take.nativeReady = false;
        // A final may arrive after stop/onend. Do not discard it immediately.
        if (!ending) finish();
        if (!ending && !take.stopping) {
          if (take.nativeFailed) { paintCaptureReadiness(take); return; }
          if (take.heard || final) finishGeminiListen(true);
          else {
            clearTimeout(startTimer);
            restartTimer = setTimeout(() => {
              if (!valid() || ending || take.stopping) return;
              try { start(); } catch { take.nativeFailed = true; paintCaptureReadiness(take); }
            }, 150);
          }
        }
      };
      start();
      return {
        end() {
          ending = true;
          return new Promise(resolve => {
            clearTimeout(restartTimer); clearTimeout(startTimer);
            resolveEnd = resolve; timer = setTimeout(finish,final && !take.nativeDraft ? 40 : 900);
            try { recognizer.stop(); } catch { finish(); }
          });
        },
        cancel() { active = false; clearTimeout(timer); clearTimeout(startTimer); clearTimeout(restartTimer); resolveEnd?.(null); resolveEnd = null; try { recognizer.abort(); } catch { /* ended */ } },
      };
    } catch { active = false; clearTimeout(startTimer); nativeRestUntil = Date.now()+60000; return null; }
  }
  function cleanRepeatedPhrases(raw) {
    let text = String(raw || '').trim();
    // Only exact adjacent phrases, within this turn. Keep short emphatic repeats,
    // numbers, corrections, and repeated answers in separate turns untouched.
    for (let pass = 0; pass < 8; pass++) {
      const words = [...text.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)*/gu)];
      if (words.length > 256) break;
      let removed = false;
      outer: for (let i = 0; i < words.length; i++) {
        for (let n = Math.floor((words.length - i) / 2); n >= 4; n--) {
          const phrase = words.slice(i, i + n);
          if (phrase.some(w => /\p{N}/u.test(w[0]))) continue;
          if (!phrase.every((w, j) => w[0].toLowerCase() === words[i + n + j][0].toLowerCase())) continue;
          text = text.slice(0, words[i].index) + text.slice(words[i + n].index);
          removed = true;
          break outer;
        }
      }
      if (!removed) break;
    }
    return text;
  }
  async function startGeminiListen() {
    if (!canListen() || openingMic || S.recording) return false;
    const owner = S.session;
    const epoch = ++captureEpoch;
    openingMic = true;
    setMode('starting', 'Opening microphone…');
    const take = { recorder:null, chunks:[], frames:[], preRoll:[], owner, epoch, heard:false, loudAt:0, voicedMs:0,
      quietAt:0, previewText:'', started:Date.now(), timer:null, stopping:false, cancelled:false,
      micStarted:false, liveReady:false, pcmUnavailable:!root.SageTranscription };
    capture = take;
    take.native = nativeEnglishFallback ? englishBrowserListener(take) : null;
    paintCaption('', false);
    warmRecognition();
    take.live = warmEars; warmEars = null;
    S.sttMode = take.native ? 'english-browser' : take.live ? 'gemini-transcribe' : 'gemini-audio';
    els().overlay?.setAttribute('data-recognition',S.sttMode);
    if (take.live) {
      take.live.connected.then(ready => {
        if (!current(owner) || capture !== take || take.cancelled || take.stopping) return;
        ready &&= !!take.live?.available;
        take.liveReady = ready;
        if (!ready) {
          retireRecognition(take.live); take.live = null;
        }
        paintCaptureReadiness(take);
      });
      // Binding happens before awaiting permission. Buffered first words are
      // sent after setupComplete, never dropped while networking warms up.
      take.live.bind({
        onText:(text, final) => {
          if (!current(owner) || capture !== take || take.cancelled || take.stopping) return;
          if (!take.heard) return; // never turn idle noise into a command
          take.previewText = text;
          paintCaption(text, !final);
          paintCaptureReadiness(take);
          // Caption arrival is networking, not renewed microphone activity.
        },
        onBoundary:() => {
          if (current(owner) && capture === take && !take.stopping && take.heard && take.previewText) finishGeminiListen(true);
        },
      });
    }
    try {
      const stream = await startMeter();
      if (!current(owner) || epoch !== captureEpoch || capture !== take || !canListen()) return false;
      const mime = pickRecMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      take.recorder = recorder;
      take.started = Date.now();
      recorder.ondataavailable = event => {
        if (!take.cancelled && event.data?.size) take.chunks.push(event.data);
      };
      recorder.onstop = () => completeCapture(take);
      recorder.onerror = () => {
        if (current(owner) && capture === take) pauseListening('Recording failed. Tap the mic to retry.');
      };
      recorder.onstart = () => {
        if (!current(owner) || capture !== take || take.cancelled) return;
        take.micStarted = true;
        paintCaptureReadiness(take);
      };
      S.recording = true;
      recorder.start(100);
      const pcmStarted = Date.now();
      const abandonPartialPCM = () => {
        take.liveGap = true; take.pcmUnavailable = true;
        take.live?.close(); take.live = null;
        paintCaptureReadiness(take);
      };
      take.readyTimer = setTimeout(() => {
        if (!current(owner) || capture !== take || take.cancelled || take.stopping || take.pcmAt || take.pcmUnavailable) return;
        // A stalled worklet must not strand startup. MediaRecorder already
        // owns the complete utterance; switch this turn to that recording.
        abandonPartialPCM();
      }, 1500);
      root.SageTranscription?.attach(stream, actx, frame => {
        if (capture !== take || take.cancelled) return;
        if (frame.failed) {
          take.pcmBroken = true; take.pcmUnavailable = true;
          take.live?.close(); take.live = null;
          liveDisabled = true; releaseWarmRecognition();
          paintCaptureReadiness(take); return;
        }
        take.frames.push(frame.pcm);
        take.pcmLevel = frame.rms;
        take.pcmAt = Date.now();
        let speechStarted = false;
        if (!take.vadReady && Number.isFinite(frame.speechMs) && !take.previewText) {
          // A startup click seen by the coarse meter must not survive the
          // first real speech classification from a cold-loaded worklet.
          take.heard = false; take.loudAt = take.quietAt = 0;
        }
        take.vadReady = Number.isFinite(frame.speechMs);
        take.pcmSpeech = take.vadReady ? frame.speechMs > 0 && frame.activeMs > 0
          : frame.rms > Math.max(0.005, noiseFloor * 1.6);
        const duration = frame.pcm.byteLength / 32;
        if (take.pcmSpeech) take.voicedMs += take.vadReady ? Math.min(frame.speechMs, frame.activeMs) : duration;
        else take.voicedMs = 0;
        // Real speech, not volume alone. Keep a half-second prefix so this
        // confirmation never clips the first syllable or requires a repeat.
        if (take.pcmSpeech && (take.voicedMs >= 120 || !take.vadReady && duration >= 80)) {
          speechStarted = !take.heard;
          take.heard = true; take.quietAt = 0;
        }
        if (take.heard) {
          for (const pcm of take.preRoll) take.live?.push(pcm);
          take.preRoll = [];
          take.live?.push(frame.pcm);
        } else {
          take.preRoll.push(frame.pcm);
          while (take.preRoll.reduce((n,pcm) => n+pcm.byteLength,0) > 16000) take.preRoll.shift();
        }
        clearTimeout(take.readyTimer);
        paintCaptureReadiness(take);
        if (speechStarted && !take.previewText) setHint('I can hear you. No need to repeat — your words are on the way.');
      }).then(handle => {
        if (!current(owner) || capture !== take || take.cancelled || take.stopping) { handle?.stop(); return; }
        take.pcm = handle;
        // Only use the full recording if speech could have preceded PCM.
        // A cold module load during silence need not disable live captions.
        take.liveGap ||= Date.now() - pcmStarted > 120 && (take.prefixSpeech || !meterAnalyser);
        if (take.liveGap) { take.live?.close(); take.live = null; }
        if (!handle) {
          take.pcmUnavailable = true;
          take.live?.close(); take.live = null; liveDisabled = true; releaseWarmRecognition();
        }
        paintCaptureReadiness(take);
      }).catch(() => {
        if (!current(owner) || capture !== take || take.cancelled || take.stopping) return;
        // A worklet failure must not abandon the already-running recorder.
        take.live?.close(); take.live = null;
        take.pcmUnavailable = true;
        liveDisabled = true; releaseWarmRecognition();
        paintCaptureReadiness(take);
      });
      take.timer = setInterval(() => {
        if (capture !== take || take.stopping) return;
        const now = Date.now();
        // A node can stall without firing processorerror. Its earlier packets
        // are not a complete recording. Keep the MediaRecorder's full turn.
        if (take.pcmAt && now - take.pcmAt > 500 && !take.pcmUnavailable) abandonPartialPCM();
        // Detection runs independently of visual animation frames. Lower the
        // continuation threshold so quiet syllables remain in the turn.
        // A crashed/stalled worklet must not freeze its last loud frame and
        // hold recording for the entire 45-second limit.
        const level = take.pcmAt && now - take.pcmAt < 250 ? take.pcmLevel : sampleMeter();
        if (!take.pcmAt && level > 0.003) take.prefixSpeech = true;
        take.peakLevel = Math.max((take.peakLevel || 0) * 0.995, level);
        // A voice falling back to a fan's steady floor is a pause even when
        // the absolute level remains above the old 0.0045 threshold.
        const threshold = Math.max(take.heard ? 0.003 : 0.005, noiseFloor * 1.6,
          take.heard ? take.peakLevel * 0.22 : 0);
        const loud = take.pcmAt && now - take.pcmAt < 250 && take.vadReady ? take.pcmSpeech : level > threshold;
        els().orb?.setAttribute('data-speech-active', String(loud));
        if (loud) {
          take.quietAt = 0;
          if (!take.loudAt) take.loudAt = now;
          if (!take.vadReady && now - take.loudAt >= 100 && !take.heard) {
            take.heard = true;
            if (!take.previewText) setHint('I can hear you. No need to repeat — your words are on the way.');
          }
        } else {
          take.loudAt = 0;
          if (take.heard) {
            if (!take.quietAt) take.quietAt = now;
            if (now - take.quietAt >= settings.pauseMs) finishGeminiListen(true);
          }
        }
        // Bytes alone are not speech: silence also produces compressed data.
        if (!take.heard && (!take.loudAt || now-take.loudAt >= 1000) && now - take.started >= 15000) {
          // Bound the silent buffer, not the hands-free session. Discard it
          // locally and keep the same microphone stream enabled.
          keepRecognition(take.live); take.live = null;
          cancelGeminiListen();
          startListening();
        } else if (now - take.started >= 45000) finishGeminiListen(true);
      }, 100);
      return true;
    } catch (err) {
      if (current(owner) && epoch === captureEpoch) {
        S.lastMicErr = err.message === 'mic-timeout' ? err.message : err.name;
        pauseListening(micProblem());
      }
      return false;
    } finally { if (epoch === captureEpoch) openingMic = false; }
  }
  function paintCaptureReadiness(take) {
    if (capture !== take || !current(take.owner) || take.cancelled || take.stopping) return;
    let label = 'Opening microphone…';
    let instruction = 'Allow microphone access to get started.';
    if (take.micStarted) {
      if (!take.pcmAt && !take.pcmUnavailable) {
        label = 'Starting audio…';
        instruction = 'Your mic is recording while audio starts.';
      } else if (take.native && !take.nativeReady && !take.nativeFailed) {
        label = 'Connecting recognition…'; instruction = 'Your microphone is recording while English recognition connects.';
      } else if (take.nativeFailed && recognitionNotice) {
        label = 'Recognition unavailable'; instruction = 'Microphone is ready. Check your speech service or key in settings.';
      } else if (take.live && !take.liveReady && !take.previewText) {
        label = 'Connecting…';
        instruction = 'Your mic is ready. First words are kept while captions connect.';
      } else {
        label = 'I’m listening';
        instruction = take.live || take.native ? 'Speak naturally in English. Pause when you’re done.' : 'Speak in English. Captions appear after your pause.';
      }
    }
    // Audio frames arrive every 100ms. Only update when readiness changes so
    // screen readers do not keep announcing the same status during speech.
    if (take.readyLabel === label && take.readyInstruction === instruction) return;
    take.readyLabel = label; take.readyInstruction = instruction;
    setMode(label === 'I’m listening' ? 'listening' : 'starting', label);
    const el = $('sageVoiceInstruction');
    if (el) el.textContent = instruction;
    setHint(label === 'I’m listening' ? recognitionNotice || 'Pause to send, or tap the orb when you’re done.' : '');
  }
  function cancelGeminiListen() {
    const take = capture;
    capture = null;
    S.recording = false;
    if (!take) return;
    take.cancelled = true;
    take.native?.cancel();
    take.live?.close();
    take.pcm?.stop().catch(() => {});
    clearInterval(take.timer);
    clearTimeout(take.stopTimer);
    clearTimeout(take.readyTimer);
    take.chunks = [];
    take.frames = [];
    take.preRoll = [];
    try { if (take.recorder && take.recorder.state !== 'inactive') take.recorder.stop(); } catch { /* already stopped */ }
  }
  function finishGeminiListen(commit) {
    const take = capture;
    if (!take || take.stopping || !take.recorder) return;
    if (!commit) { cancelGeminiListen(); return; }
    if (take.vadReady && !take.heard && !take.previewText) {
      // Tapping the orb or a recording deadline in silence is still silence.
      keepRecognition(take.live); take.live = null;
      cancelGeminiListen(); startListening(); return;
    }
    // Only the settled, authoritative transcript may execute a close command.
    take.stopping = true;
    clearInterval(take.timer);
    clearTimeout(take.readyTimer);
    S.recording = false;
    S.transcribing = true;
    setMode('transcribing');
    setHint('');
    // Flush the last PCM packet and finalize recognition alongside the
    // recorder. A slow recorder stop must not delay the speech endpoint.
    finalizeCapture(take);
    try {
      // dataavailable arrives BEFORE stop; only onstop assembles the blob.
      // Some recorders never dispatch stop. PCM capture can still finish the
      // same utterance; the guarded completion handles a late event only once.
      take.stopTimer = setTimeout(() => completeCapture(take), 1000);
      take.recorder.stop();
    } catch { pauseListening('Could not finish the recording. Tap the mic to retry.'); }
  }
  function finalizeCapture(take) {
    return take.finalizing ||= (async () => {
      const native = take.native?.end();
      try {
        if (await bounded(take.pcm?.stop(), 200, 'capture-timeout') === false) take.pcmBroken = true;
      } catch { take.pcmBroken = true; }
      if (take.pcmBroken) { take.live?.close(); take.live = null; }
      let live;
      try { live = take.liveGap || take.pcmBroken ? null : await bounded(take.live?.end(), 2500, 'timeout'); }
      catch { take.live?.close(); }
      return {native:await native,live};
    })();
  }
  async function completeCapture(take) {
    if (take.cancelled || take.completing || capture !== take || !current(take.owner)) return;
    take.completing = true;
    clearInterval(take.timer);
    clearTimeout(take.stopTimer);
    S.recording = false;
    S.transcribing = true;
    setMode('transcribing');
    const {native:nativeText,live:liveText} = await finalizeCapture(take);
    take.native?.cancel();
    if (take.cancelled || capture !== take || !current(take.owner)) { take.live?.close(); return; }
    const liveFailed = take.live && !take.live.available;
    if (liveText && !take.liveGap && !take.pcmBroken) keepRecognition(take.live);
    else if (liveFailed) retireRecognition(take.live);
    else take.live?.close();
    capture = null;
    if (nativeText) {
      take.chunks = []; take.frames = []; S.transcribing = false;
      recognitionNotice = ''; recoveryEpisode = '';
      acceptTranscript(nativeText); return;
    }
    if (liveText) {
      recognitionNotice = ''; recoveryEpisode = '';
      take.chunks = []; S.transcribing = false;
      acceptTranscript({transcript:liveText,unclear:false});
      return;
    }
    // A rejected/slow Live route never loses this utterance or repeatedly
    // reconnects. Use the same complete audio, including its first syllable.
    const recording = {blob:new Blob(take.chunks, {type:take.recorder.mimeType || 'audio/webm'}),
      pcm:!take.liveGap && !take.pcmBroken && take.frames.length ? take.frames : null,
      b64:null, previewText:take.previewText};
    take.chunks = [];
    take.frames = [];
    await transcribeRecording(recording, take.owner, take.epoch);
  }
  async function transcribeRecording(recording, owner, epoch) {
    try {
      if (!recording.blob.size && !recording.pcm?.length) throw new Error('empty-recording');
      if (!recording.b64) {
        // Reuse the actual PCM captured for Live. This avoids a second audio
        // context/decoder on the normal fallback path, including first words.
        const wav = recording.pcm ? pcmToWav(recording.pcm)
          : await bounded(recordingToWav(recording.blob), 4000, 'timeout');
        if (!current(owner) || epoch !== captureEpoch) return;
        recording.b64 = await bounded(blobToBase64(wav), 1000, 'timeout');
        recording.pcm = null;
      }
      if (!current(owner) || epoch !== captureEpoch) return;
      const result = await transcribeWithGemini(recording.b64, owner);
      if (!current(owner) || epoch !== captureEpoch) return;
      recognitionNotice = '';
      recoveryEpisode = '';
      S.transcribing = false;
      // A command inferred from audio must not dismiss a call when the live
      // words disagree (for example a greeting hallucinated as an exit).
      const closeDisagrees = isCloseCommand(result.transcript) && recording.previewText && !isCloseCommand(recording.previewText);
      acceptTranscript(closeDisagrees ? { ...result, unclear:true } : result);
    } catch (err) {
      if (!current(owner) || epoch !== captureEpoch) return;
      // Discard uncertain audio, ask once aloud, then start a fresh turn. Never
      // execute a preview or keep submitting the failed recording in a loop.
      stopListening();
      S.recognitionFailed = false;
      recognitionNotice = recognitionProblem(err);
      // An unavailable API does not trap English conversation behind the same
      // provider. This recognizer is input only; TTS never uses browser voices.
      nativeEnglishFallback = !!(root.SpeechRecognition || root.webkitSpeechRecognition);
      if (nativeEnglishFallback) { liveDisabled = true; releaseWarmRecognition(); }
      const episode = 'recognition'; // one announcement until a real turn succeeds
      const blocked = /^(?:quota|no-key|stt-auth|stt-access|stt-model)$/.test(err.message);
      if (blocked) {
        // A service limit is not something the user said. Switch input quietly,
        // retain the exact error in the hint, and never synthesize a quota loop.
        S.busy = false;
        paintCaption('', false);
        await startListening();
        if (current(owner)) setHint(recognitionNotice);
        return;
      }
      if (recoveryEpisode === episode) {
        S.busy = false;
        await startListening();
        if (current(owner)) setHint(recognitionNotice);
        return;
      }
      recoveryEpisode = episode;
      S.busy = true;
      paintCaption('', false);
      const clarification = 'Recognition had a problem. Could you say it again?';
      addLine('her', clarification);
      paintMic();
      await deliverReply(clarification, owner);
      if (current(owner)) setHint(recognitionProblem(err));
    }
  }
  function recognitionProblem(err) {
    const code = err.message;
    if (code === 'quota') return `Recognition quota is busy. Try again in ${Math.max(1,Math.ceil(((err.retryAt || Date.now()+60000)-Date.now())/1000))} seconds. Your microphone stays ready.`;
    if (code === 'no-key' || code === 'stt-auth') return 'Recognition key was rejected. Check your Gemini key in settings.';
    if (code === 'stt-access') return 'Recognition access was denied. Check API/key restrictions in settings.';
    if (code === 'stt-model') return 'No supported recognition model was available. Check model access in settings.';
    if (code === 'timeout' || err.name === 'AbortError') return 'Recognition timed out. I’m listening again — please repeat.';
    if (code === 'network' || /^stt-5/.test(code)) return 'Recognition could not reach the service. Check your connection; I’m listening again.';
    return 'I couldn’t read that clearly. I’m listening again — please repeat.';
  }
  async function recordingToWav(blob) {
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) throw new Error('audio-decode-unavailable');
    const ctx = new AC();
    let timedOut = false;
    try {
      return await bounded((async () => {
        const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
        if (timedOut) throw new Error('timeout');
        const rate = 16000;
        const length = Math.ceil(audio.duration * rate);
        const offline = new (root.OfflineAudioContext || root.webkitOfflineAudioContext)(1, length, rate);
        const source = offline.createBufferSource();
        source.buffer = audio;
        source.connect(offline.destination);
        source.start();
        const mono = (await offline.startRendering()).getChannelData(0);
        if (timedOut) throw new Error('timeout');
        const buffer = new ArrayBuffer(44 + mono.length * 2);
        const view = new DataView(buffer);
        const str = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
        str(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
        view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data');
        view.setUint32(40, mono.length * 2, true);
        mono.forEach((sample, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767), true));
        return new Blob([buffer], { type: 'audio/wav' });
      })(), 3500, 'timeout', () => { timedOut = true; ctx.close().catch(() => {}); });
    } finally { ctx.close().catch(() => {}); }
  }
  function pcmToWav(frames) {
    const length = frames.reduce((n,frame) => n + frame.byteLength, 0);
    const buffer = new ArrayBuffer(44 + length), view = new DataView(buffer);
    const str = (offset, value) => [...value].forEach((c,i) => view.setUint8(offset+i,c.charCodeAt(0)));
    str(0,'RIFF'); view.setUint32(4,buffer.byteLength-8,true); str(8,'WAVE'); str(12,'fmt ');
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
    view.setUint32(24,16000,true); view.setUint32(28,32000,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
    str(36,'data'); view.setUint32(40,length,true);
    const bytes = new Uint8Array(buffer); let offset = 44;
    for(const frame of frames) { bytes.set(new Uint8Array(frame),offset); offset += frame.byteLength; }
    return new Blob([buffer],{type:'audio/wav'});
  }
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('unreadable'));
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(blob);
    });
  }
  async function transcribeWithGemini(b64, owner) {
    const configured = gemKeys().slice(0, 3);
    if (!configured.length) throw unavailableKey();
    const preferred = GEM_STT_MODEL;
    const models = [...new Set([sttRoute?.preferred === preferred ? sttRoute.model : preferred, preferred, 'gemini-3.5-flash-lite'])];
    const id = route => route.model + ':' + route.key;
    const routes = configured.flatMap(key => models.map(model => ({model,key,
      simple:sttRoute?.model === model && sttRoute.simple}))).filter(route =>
      (sttCooldowns.get(route.key)?.retryAt || 0) <= Date.now() && (sttModelRest.get(id(route))?.retryAt || 0) <= Date.now());
    if (!routes.length) {
      const rests = configured.flatMap(key => [sttCooldowns.get(key), ...models.map(model => sttModelRest.get(id({key,model})))]).filter(Boolean);
      const rest = rests.find(r=>r.code==='stt-auth' || r.code==='stt-access') || rests.reduce((a,b)=>a.retryAt<b.retryAt?a:b);
      throw Object.assign(new Error(rest.code), {retryAt:rest.retryAt});
    }
    const controller = new AbortController(); sttController = controller;
    let index = 0, lastError;
    // A quota belongs to a model + key, while invalid keys/restrictions apply
    // to every model. Try an available route for the SAME complete recording.
    try {
      return await bounded((async () => {
        for (let attempt=0; attempt<3 && index<routes.length; attempt++) {
          if (!current(owner) || controller.signal.aborted) throw new Error('cancelled');
          const route = routes[index];
          if ((sttCooldowns.get(route.key)?.retryAt || 0) > Date.now()) {index++; attempt--; continue;}
          const generationConfig = {temperature:0, maxOutputTokens:1200,
            responseMimeType:'application/json', responseSchema:{type:'OBJECT',
              properties:{transcript:{type:'STRING'}, unclear:{type:'BOOLEAN'}}, required:['transcript','unclear']}};
          if (!route.simple) generationConfig.thinkingConfig = {thinkingLevel:'minimal'};
          let res;
          try {
            res = await fetch(`${GEM_API}/models/${route.model}:generateContent`, {
              method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':route.key}, signal:controller.signal,
              body:JSON.stringify({systemInstruction:{parts:[{text:'You transcribe audio; you do not converse. Return only the English words actually audible, preserving Indian-English speech, corrections, names and numbers. Never answer, translate, summarize, finish a sentence or add a greeting/name/addressee. A spoken hello is just Hello. Do not infer names from the app or context. Domain vocabulary only when audible: SpinLog, KTM Duke, odometer, mileage, petrol, service, PUC. Return JSON with transcript (string) and unclear (boolean). Silence, music or unintelligible audio means an empty transcript. Mark unclear true when a word or number cannot be confidently heard.'}]},
                contents:[{role:'user',parts:[{inlineData:{mimeType:'audio/wav',data:b64}}]}],generationConfig}),
            });
          } catch {
            if (controller.signal.aborted) throw new Error('timeout');
            lastError = new Error('network');
            if (attempt === 0) continue;
            index++; continue;
          }
          if (!current(owner) || controller.signal.aborted) throw new Error('cancelled');
          if (!res.ok) {
            let detail = {};
            try { detail = await res.json(); } catch { /* HTTP status identifies the failure. */ }
            const message = detail?.error?.message || '';
            const auth = res.status === 401 || /API.?key.*(?:invalid|expired|not valid)|API_KEY_INVALID/i.test(message);
            const restriction = res.status === 403 && /referer|referrer|API_KEY|blocked|disabled/i.test(message);
            const retry = Number(res.headers?.get('retry-after'));
            if (auth || restriction) {
              const code = auth ? 'stt-auth' : 'stt-access';
              sttCooldowns.set(route.key,{code,retryAt:Date.now()+Math.max(300000,Number.isFinite(retry)?retry*1000:0)});
              lastError = new Error(code); index++; continue;
            }
            if (res.status === 429) {
              const retryAt = Date.now()+Math.max(60000,Number.isFinite(retry)?retry*1000:0);
              sttModelRest.set(id(route),{code:'quota',retryAt});
              lastError = Object.assign(new Error('quota'),{retryAt}); index++; continue;
            }
            if (res.status === 400 && !route.simple && /thinking|thinkingBudget|thinkingLevel/i.test(message)) {route.simple=true; continue;}
            if ([403,404].includes(res.status) || res.status===400 && /model.*(?:not found|not supported|unavailable)/i.test(message)) {
              sttModelRest.set(id(route),{code:'stt-model',retryAt:Date.now()+300000});
              lastError = new Error('stt-model'); index++; continue;
            }
            lastError = new Error(`stt-${res.status}`);
            if (res.status>=500 && attempt===0) continue;
            index++; continue;
          }
          let json;
          try { json = await res.json(); } catch { throw new Error(controller.signal.aborted ? 'timeout' : 'invalid-transcript'); }
          const candidate = json?.candidates?.[0];
          if (json?.promptFeedback?.blockReason || candidate?.finishReason && candidate.finishReason!=='STOP') throw new Error('stt-blocked');
          const raw = (candidate?.content?.parts || []).filter(p=>!p.thought).map(p=>p.text||'').join('').trim().replace(/^```(?:json)?\s*|\s*```$/g,'');
          let parsed;
          try {parsed=JSON.parse(raw);} catch {throw new Error('invalid-transcript');}
          if (typeof parsed.transcript!=='string' || typeof parsed.unclear!=='boolean') throw new Error('invalid-transcript');
          sttRoute={preferred,model:route.model,simple:route.simple};
          sttCooldowns.delete(route.key); sttModelRest.delete(id(route));
          return parsed;
        }
        throw lastError || new Error('stt-model');
      })(), 10000, 'timeout', () => controller.abort());
    } finally { if (sttController===controller) sttController=null; }
  }
  function acceptTranscript(result) {
    const text = cleanRepeatedPhrases(result.transcript);
    if (!text) {
      // An empty transcript is not a microphone failure. Wait for the next
      // utterance; VAD still prevents silent recordings from being uploaded.
      if (canListen()) startListening();
      return;
    }
    if (result.unclear) {
      // No confirmation form and no guessed mutation. Ask aloud and immediately
      // return to hands-free listening; the uncertain draft stays out of tools.
      stopListening(); S.busy = true;
      paintCaption('', false); addLine('you', text);
      const clarification = 'I missed part of that. Could you say it once more?';
      addLine('her', clarification);
      deliverReply(clarification, S.session);
      return;
    }
    sendVoiceText(text);
  }
  function stopListening() {
    captureEpoch++;
    openingMic = false;
    if (sttController) sttController.abort();
    sttController = null;
    S.transcribing = false;
    cancelGeminiListen();

  }

  function pokeOrb(v) {
    const e = els();
    if (e.orb) e.orb.style.setProperty('--sage-voice-hit', String(Math.min(1, Math.max(0, v || 0))));
  }

  function paintLevel(level) {
    const e = els();
    if (!e.orb) return;
    const amplitude = Math.min(1, Math.max(0, level));
    e.orb.style.setProperty('--sage-voice-level', amplitude.toFixed(3));
    const motion = root.dkReduceMotion?.() ? 0 : amplitude;
    e.orb.style.setProperty('--sage-voice-x', `${(Math.sin(Date.now() / 110) * motion * 3).toFixed(2)}px`);
    e.orb.style.setProperty('--sage-voice-y', `${(Math.cos(Date.now() / 140) * motion * 2).toFixed(2)}px`);
    e.orb.style.setProperty('--sage-voice-tilt', `${(Math.sin(Date.now() / 170) * motion * 2).toFixed(2)}deg`);
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
      starting: 'Getting ready…',
      transcribing: 'Processing…',
      listening: 'I’m listening',
      thinking: 'Thinking…',
      speaking: 'Speaking',
    }[mode] || 'Voice';
    if (e.state) e.state.textContent = label;
    if (!S.recording) e.orb?.setAttribute('data-speech-active', 'false');
    const instruction = $('sageVoiceInstruction');
    if (instruction) instruction.textContent = { listening: 'Speak naturally. Pause when you’re done.', thinking: 'You’ll hear the reply as soon as it’s ready.', transcribing: 'Catching every word.', speaking: 'Tap the orb to interrupt.', idle: 'Take your time. I’m here.' }[mode] || '';
    if (e.orb) e.orb.setAttribute('aria-label', S.docked ? 'Open voice conversation' : mode === 'speaking' ? 'Interrupt reply' : S.recording ? 'Finish speaking and send' : S.lastSaid ? 'Restore audio' : 'Conversation controls');
    paintMic();
  }

  function setHint(line) {
    const e = els();
    if (e.hint) e.hint.textContent = line || '';
  }

  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** The live "you: …" line while he talks. Replaced, never stacked. */
  function paintCaption(full, live, draft = false) {
    const e = els();
    if (!e.caption) return;
    const f = String(full || '').trim();
    if (!f) {
      e.caption.textContent = '';
      return;
    }
    e.caption.innerHTML = `<span class="sage-voice-you">you · </span>${esc(f)}`
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
    div.innerHTML = `<strong>${who === 'you' ? 'You' : 'Sage'}</strong><span>${esc(who === 'you' ? String(text) : plainVoiceText(text))}</span>`;
    const previous = [...e.lines.children];
    const tops = previous.map(line => line.getBoundingClientRect().top);
    e.lines.appendChild(div);
    while (e.lines.children.length > 4) e.lines.firstChild.remove();
    if (!root.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      previous.forEach((line, i) => {
        if (line.isConnected && line.animate) line.animate([
          { transform: `translateY(${tops[i] - line.getBoundingClientRect().top}px)` },
          { transform: 'translateY(0)' },
        ], { duration: 280, easing: 'ease-out' });
      });
    }
    e.lines.scrollTop = e.lines.scrollHeight;
  }

  function paintMic() {
    const e = els();
    if (!e.mic) return;
    e.mic.classList.toggle('is-off', S.muted);
    e.mic.classList.toggle('is-live', S.recording);
    e.mic.setAttribute('aria-pressed', String(S.muted));
    e.mic.setAttribute('aria-label', S.muted ? 'Resume microphone' : 'Mute microphone');
    e.mic.title = S.muted ? 'Resume microphone' : 'Mute microphone';
    e.mic.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V6Zm-3 5v1a6 6 0 0 0 12 0v-1M12 18v3m-3 0h6${S.muted ? 'M3 3l18 18' : ''}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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

  function voiceProblem(reason, retryInMs) {
    if (reason === 'no-key') return 'Add a Gemini key in settings so I can answer and speak.';
    if (reason === 'offline') return 'You are offline, so I cannot answer right now.';
    if (reason === 'backoff') return `Reply service is temporarily limited.${retryInMs > 0 ? ` Try again in ${Math.ceil(retryInMs / 1000)} seconds.` : ' Try again shortly.'} Your words are saved in chat.`;
    return 'The reply service could not answer. Your words are saved in chat; please try again.';
  }

  function audioProblem(err) {
    if (err?.message === 'english-only') return 'Replies are English-only. Please ask again; your request is saved in chat.';
    if (err?.message === 'quota') return 'Voice quota reached. Your reply is saved in chat. Try again shortly.';
    if (err?.message === 'play-blocked') return 'Sound is blocked by the browser. Tap the orb to enable audio.';
    if (err?.message === 'no-key') return 'Add or unlock a Gemini key in Sage settings for spoken replies.';
    if (err?.message === 'stt-auth') return 'Your Gemini key was rejected. Check it in settings; your reply is saved in chat.';
    if (/^tts-(?:401|403|404)$/.test(err?.message || '')) return 'Your Gemini key cannot access the saved voice model. Check the key in settings; your reply is saved in chat.';
    return 'Audio is unavailable right now. Your reply is saved in chat. You can keep talking.';
  }
  async function deliverReply(text, owner) {
    S.lastSaid = text;
    warmRecognition(); // connect the next turn while this reply plays
    let failure;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const completed = await speak(text);
        if (!current(owner)) return;
        S.lastSaid = null;
        S.busy = false;
        if (S.resumeAfterReply) {
          S.resumeAfterReply = false;
          S.muted = false;
          meterStream?.getTracks().forEach(t => { t.enabled = true; });
          paintMic();
        }
        setMode('idle');
        setHint(S.muted ? 'Mic off. Tap the mic when you’re ready.' : '');
        if (!S.muted) startListening();
        return completed;
      } catch (err) {
        if (!current(owner)) return;
        failure = err;
        const transient = err.name === 'TypeError' || err.name === 'AbortError'
          || /^(?:tts-5\d\d|tts-408|silent-audio|incomplete-audio|tts-stream|timeout)$/.test(err.message);
        if (attempt || err.audioStarted || !transient || S.backgrounded) break;
        const token = voiceSession;
        setMode('thinking', 'Restoring audio…');
        setHint('');
        await new Promise(resolve => setTimeout(resolve, 400));
        if (!current(owner)) return;
        if (voiceSession !== token) {
          S.lastSaid = null; S.busy = false;
          if (canListen()) startListening();
          return;
        }
        if (S.backgrounded) break;
      }
    }
    if (!current(owner)) return;
    S.busy = false;
    if (failure?.message === 'play-blocked') {
      S.resumeAfterReply = !S.muted;
      pauseListening(audioProblem(failure));
    } else {
      // A persistent service outage must not create endless retries or a
      // disconnected-looking call. Resume the existing hands-free session.
      S.lastSaid = null;
      S.resumeAfterReply = false;
      setMode('idle');
      if (!S.muted && !S.backgrounded) await startListening();
      if (current(owner)) setHint(audioProblem(failure));
    }
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
    if (!toolName || !/^(list_|get_|read_|recall_|search|inspect_page_|memory_stats)/.test(toolName)) { setActivityRaw(null, null); return; }
    const T = root.SageTools;
    const phrase = T && T.describe ? T.describe(toolName) : 'working on something';
    const glyph = T && T.iconFor ? T.iconFor(toolName) : 'fa-gear';
    setActivityRaw(glyph, `she is ${phrase}`);
  }

  async function sendVoiceText(raw) {
    const said = cleanRepeatedPhrases(raw);
    if (!said || !S.open) return;
    if (isCloseCommand(said)) {
      pushTurn({ role: 'user', text: said, at: Date.now(), via: 'voice' });
      close();
      return;
    }
    if (S.busy) return;
    const owner = S.session;
    S.busy = true;
    S.finalText = '';
    S.speechSeen = false;
    stopListening();
    warmRecognition(); // overlap next-turn setup with the current answer
    setMode('thinking');
    paintCaption('', false);
    addLine('you', said);
    setHint('');
    setActivity(null);

    const AI = root.SageAI;
    if (!AI) {
      setHint('Sage is not loaded yet.');
      setActivity(null);
      S.busy = false;
      pauseListening('Sage is not loaded yet. Close voice mode and reload the app.');
      return;
    }

    pushTurn({ role: 'user', text: said, at: Date.now(), via: 'voice' });
    try { root.SageMemory && root.SageMemory.noteMessage && root.SageMemory.noteMessage(); } catch { /* ignore */ }

    const history = chatHistory().slice(0, -1).map(t => ({ role: t.role, text: t.text }));
    let result = null;
    try {
      result = await AI.askSage(said, {
        history,
        voice: true,
        isCancelled: () => !current(owner),
        maxTokens: 480, // leave room for complete replies; brevity belongs in the prompt
        onTool: name => {
          if (S.open && owner === S.session) setActivity(name);
        },
      });
    } catch (err) {
      result = { ok: false, reason: 'failed' };
    }

    if (!S.open || owner !== S.session) return;

    if (!result || !result.ok) {
      const line = voiceProblem(result?.reason, result?.retryInMs);
      setActivity(null);
      S.busy = false;
      setMode('idle');
      if (!S.muted) await startListening();
      if (current(owner)) setHint(line);
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
    await deliverReply(result.text, owner);
  }

  // ════════════════════════════════════════════════════════════════════
  // Open / close — straight to listening, no greeting
  // ════════════════════════════════════════════════════════════════════
  let dockPosition = null, drag = null, windowMotion = null, suppressOrbClickUntil = 0;
  function cancelWindowMotion() { windowMotion?.cancel(); windowMotion = null; }
  function cancelDrag() {
    if (!drag) return;
    try { drag.target.releasePointerCapture(drag.id); } catch { /* already released */ }
    drag = null;
  }
  function placeDock(x, y) {
    const overlay = els().overlay;
    if (!overlay || !S.docked) return;
    const viewport = root.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || root.innerWidth, height = viewport?.height || root.innerHeight;
    const box = overlay.getBoundingClientRect(), margin = 12;
    dockPosition = {
      x:Math.max(left+margin, Math.min(x ?? left+width-box.width-margin, left+width-box.width-margin)),
      y:Math.max(top+margin, Math.min(y ?? top+height-box.height-(width <= 540 ? 96 : 24), top+height-box.height-margin)),
    };
    overlay.style.left = `${dockPosition.x}px`; overlay.style.top = `${dockPosition.y}px`;
  }
  function animateWindow(before) {
    const orb = els().orb;
    if (!before?.width || !orb?.animate || root.dkReduceMotion?.()) return;
    const after = orb.getBoundingClientRect();
    windowMotion = orb.animate([
      {transform:`translate(${before.x-after.x}px,${before.y-after.y}px) scale(${before.width/after.width})`},
      {transform:'translate(0,0) scale(1)'},
    ], {duration:380,easing:'cubic-bezier(.22,1,.36,1)'});
  }
  function minimize() {
    if (!S.open || S.docked) return false;
    const e = els(), before = e.orb?.getBoundingClientRect();
    cancelWindowMotion();
    S.docked = true;
    e.overlay.classList.remove('sl-modal--open');
    e.overlay.classList.add('is-docked');
    e.overlay.setAttribute('role', 'region'); e.overlay.setAttribute('aria-modal', 'false');
    e.window?.setAttribute('aria-label', 'Expand conversation');
    e.window?.setAttribute('title', 'Expand conversation');
    e.orb?.setAttribute('aria-label', 'Open voice conversation');
    e.orb?.focus({preventScroll:true});
    placeDock(dockPosition?.x, dockPosition?.y);
    animateWindow(before);
    return true;
  }
  function expand() {
    if (!S.open || !S.docked) return false;
    const e = els(), before = e.orb?.getBoundingClientRect();
    cancelWindowMotion(); cancelDrag();
    S.docked = false;
    e.overlay.classList.remove('is-docked'); e.overlay.classList.add('sl-modal--open');
    e.overlay.style.removeProperty('left'); e.overlay.style.removeProperty('top');
    e.overlay.setAttribute('role', 'dialog'); e.overlay.setAttribute('aria-modal', 'true');
    e.window?.setAttribute('aria-label', 'Minimize conversation');
    e.window?.setAttribute('title', 'Minimize conversation');
    animateWindow(before); e.window?.focus({preventScroll:true});
    return true;
  }
  function wireDock(e) {
    e.window?.addEventListener('click', () => S.docked ? expand() : minimize());
    const begin = ev => {
      if (!S.open || !S.docked || ev.button !== 0 || drag) return;
      drag = {id:ev.pointerId,target:ev.currentTarget,startX:ev.clientX,startY:ev.clientY,
        x:dockPosition.x,y:dockPosition.y,moved:false};
      ev.currentTarget.setPointerCapture(ev.pointerId);
    };
    const move = ev => {
      if (!drag || drag.id !== ev.pointerId) return;
      const dx = ev.clientX-drag.startX, dy = ev.clientY-drag.startY;
      if (!drag.moved && Math.hypot(dx,dy) < 8) return;
      drag.moved = true; cancelWindowMotion();
      ev.preventDefault(); placeDock(drag.x+dx,drag.y+dy);
    };
    const end = ev => {
      if (!drag || drag.id !== ev.pointerId) return;
      if (drag.moved) suppressOrbClickUntil = Date.now()+400;
      cancelDrag();
    };
    [e.orb].forEach(el => {
      if (!el) return;
      el.addEventListener('pointerdown',begin); el.addEventListener('pointermove',move);
      el.addEventListener('pointerup',end); el.addEventListener('pointercancel',end);
      el.addEventListener('lostpointercapture',end);
    });
    e.orb?.addEventListener('keydown', ev => {
      if (!S.docked || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(ev.key)) return;
      ev.preventDefault(); const step = ev.shiftKey ? 40 : 12;
      placeDock(dockPosition.x+({ArrowLeft:-step,ArrowRight:step}[ev.key] || 0),
        dockPosition.y+({ArrowUp:-step,ArrowDown:step}[ev.key] || 0));
    });
    const resize = () => { if (S.docked) { cancelDrag(); placeDock(dockPosition?.x,dockPosition?.y); } };
    root.addEventListener?.('resize',resize);
    root.visualViewport?.addEventListener('resize',resize);
    root.visualViewport?.addEventListener('scroll',resize);
    if (root.ResizeObserver) new root.ResizeObserver(() => {
      if (S.docked) placeDock(dockPosition?.x,dockPosition?.y);
    }).observe(e.overlay);
  }
  function open() {
    const e = els();
    if (!e.overlay) return false;
    if (S.open) { expand(); return true; }
    fileTarget = null; $('sageVoiceChooseFile').hidden = true;
    S.lastFocus = document.activeElement || null;
    S.open = true;
    S.docked = false;
    e.window?.setAttribute('aria-label', 'Minimize conversation');
    e.window?.setAttribute('title', 'Minimize conversation');
    S.backgrounded = false;
    S.voiceName = settings.gemVoice;
    S.voiceRate = settings.rate;
    const storedModel = load(LS_TTS_MODEL, '');
    S.ttsPinned = TTS_MODELS.includes(storedModel);
    S.ttsModel = TTS_MODELS.includes(storedModel) ? storedModel : TTS_MODELS[0];
    sttRoute = null; recognitionNotice = ''; recoveryEpisode = '';
    S.session++;
    S.muted = false;
    S.resumeAfterReply = false;
    S.sttMode = 'gemini-transcribe';
    liveDisabled = false; nativeEnglishFallback = false; releaseWarmRecognition();
    e.overlay.setAttribute('data-recognition', S.sttMode);
    S.lastSaid = null;
    S.recognitionFailed = false;
    S.busy = false;
    S.finalText = '';
    S.speechSeen = false;
    e.overlay.hidden = false;
    requestAnimationFrame(() => { if (S.open && !S.docked) { e.overlay.classList.add('sl-modal--open'); e.end?.focus(); } });
    e.overlay.setAttribute('aria-hidden', 'false');
    paintMic();
    paintCaption('', false);
    if (e.lines) e.lines.innerHTML = '';
    setHint('');
    setActivity(null);
    unlockAudio(); // synchronous: this tap is the gesture that allows sound
    startVisualizer();

    // The next capture starts after each completed spoken reply.
    if (!configuredGemKeys().length) {
      pauseListening('Add or unlock your Gemini key in Sage settings for voice conversation.');
    } else if (!audioCaptureSupported()) {
      pauseListening('Audio recording is unavailable. Open this site in a browser with microphone recording support.');
    } else {
      if (!gemKeys().length) {
        recognitionNotice = recognitionProblem(unavailableKey());
        nativeEnglishFallback = !!(root.SpeechRecognition || root.webkitSpeechRecognition);
      }
      warmRecognition(); startListening();
    }
    return true;
  }

  function close() {
    const e = els();
    const wasDocked = S.docked;
    fileTarget = null; $('sageVoiceChooseFile').hidden = true;
    S.open = false;
    S.docked = false;
    cancelWindowMotion();
    cancelDrag();
    releaseWarmRecognition();
    S.session++;
    S.busy = false;
    S.speaking = false;
    stopListening();
    stopAllAudio();
    stopMeter();
    stopVisualizer();
    S.recognitionFailed = false;
    S.finalText = '';
    S.speechSeen = false;
    if (e.overlay) {
      // Hide before removing compact geometry: otherwise the closing orb
      // briefly regains the full-screen modal layout during the fade-out.
      if (wasDocked) e.overlay.hidden = true;
      e.overlay.classList.remove('sl-modal--open');
      e.overlay.classList.remove('is-docked');
      e.overlay.style.removeProperty('left'); e.overlay.style.removeProperty('top');
      e.overlay.setAttribute('role', 'dialog'); e.overlay.setAttribute('aria-modal', 'true');
      e.orb?.setAttribute('data-speech-active', 'false');
      e.overlay.setAttribute('aria-hidden', 'true');
      const hide = () => { try { if (!S.open) e.overlay.hidden = true; } catch { /* ignore */ } };
      if (root.dkReduceMotion && root.dkReduceMotion()) hide();
      else setTimeout(hide, 180);
    }
    setMode('idle');
    try { if (!wasDocked && S.lastFocus && S.lastFocus.focus) S.lastFocus.focus({ preventScroll: true }); }
    catch { /* ignore */ }
    S.lastFocus = null;
  }

  function toggle() { return S.open ? (close(), false) : open(); }
  function isOpen() { return S.open; }
  let fileTarget = null;
  function requestFile(input) {
    if (!S.open || !input || input.type !== 'file') return false;
    fileTarget = input;
    $('sageVoiceChooseFile').hidden = false;
    return true;
  }

  // ════════════════════════════════════════════════════════════════════
  // Wiring — the voice launcher inside chat
  // ════════════════════════════════════════════════════════════════════
  function wire() {
    const e = els();
    const mic = $('sageChatMic');
    if (mic && !mic._sageVoiceWired) {
      mic._sageVoiceWired = true;
      mic.addEventListener('click', () => open());
    }
    if (e.end && !e.end._wired) {
      e.end._wired = true;
      e.end.addEventListener('click', close);
    }
    if (e.overlay && !e.overlay._wired) {
      e.overlay._wired = true;
      wireDock(e);
      document.addEventListener('keydown', ev => {
        if (!S.open || S.docked || document.querySelector('.sl-slide-overlay:not(.is-leaving)')) return;
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); close(); }
        if (ev.key === 'Tab') {
          const buttons = [...e.overlay.querySelectorAll('button, textarea')].filter(el => el.getClientRects().length && !el.disabled);
          const first = buttons[0], last = buttons[buttons.length - 1];
          if (ev.shiftKey && (document.activeElement === first || !e.overlay.contains(document.activeElement))) { ev.preventDefault(); last?.focus(); }
          else if (!ev.shiftKey && (document.activeElement === last || !e.overlay.contains(document.activeElement))) { ev.preventDefault(); first?.focus(); }
        }
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
        if (Date.now() < suppressOrbClickUntil) return;
        if (S.docked) { expand(); return; }
        unlockAudio();
        if (S.recording) { finishGeminiListen(true); return; }
        if (S.speaking || S.mode === 'speaking') {
          S.lastSaid = null; // the cut-off line is abandoned, not retried
          stopAllAudio();
          if (!S.busy && !S.muted) { setMode('listening'); startListening(); }
          return;
        }
        if (S.busy || S.transcribing || S.recognitionFailed) return;
        if (S.lastSaid) {
          stopListening();
          S.busy = true;
          deliverReply(S.lastSaid, S.session);
          return;
        }
        if (S.mode === 'idle' && !S.muted) startListening();
      });
    }
    if (e.mic && !e.mic._wired) {
      e.mic._wired = true;
      e.mic.addEventListener('click', () => {
        unlockAudio();
        S.resumeAfterReply = false; // the user's mic choice wins over automatic recovery
        S.muted = !S.muted;
        meterStream?.getTracks().forEach(t => { t.enabled = !S.muted; });
        if (S.muted) {
          releaseWarmRecognition();
          stopListening();
          if (!S.busy && !S.speaking && !S.recognitionFailed) setMode('idle', 'Microphone paused');
          setHint('Mic off. Tap again when you’re ready.');
        } else { setHint(''); startListening(); }
        paintMic();
      });
    }
    $('sageVoiceChooseFile')?.addEventListener('click', () => {
      const input = fileTarget;
      if (!S.open || !input?.isConnected) return;
      // File pickers require this real user gesture. Existing app handlers own
      // validation, metadata and saving; choosing never implies upload success.
      try {
        input.click();
        fileTarget = null; $('sageVoiceChooseFile').hidden = true;
        minimize(); // expose the existing form while the picker is open
      } catch { setHint('Use the upload button on the page to choose your file.'); }
    });
    const preferences = [
      ['sageVoicePause', 'sage_voice_pause', load('sage_voice_pause', 'quick')],
    ];
    preferences.forEach(([id, key, value]) => {
      const input = $(id);
      if (!input) return;
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
      input.addEventListener('change', () => save(key, input.type === 'checkbox' ? input.checked : input.value));
    });
    document.addEventListener('visibilitychange', () => {
      if (!S.open) return;
      S.backgrounded=!!document.hidden;
      if (document.hidden) {
        if (S.recording || openingMic) stopListening();
        releaseWarmRecognition();
        stopMeter();
      } else {
        unlockAudio();
        if (S.resumeAfterReply && S.lastSaid && !S.busy) {
          S.busy=true;deliverReply(S.lastSaid,S.session);
        } else startListening();
      }
    });

    setMode('idle');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }

  root.SageVoice = {
    open, close, toggle, isOpen, minimize, expand, requestFile, isMinimized: () => S.open && S.docked,
    sttSupported, recognitionMode: () => S.sttMode,
    speak, interrupt, startListening, stopListening, sendVoiceText,
    settings,
  };
})(typeof self !== 'undefined' ? self : this);
