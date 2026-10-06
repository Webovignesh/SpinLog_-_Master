// Streaming ears only. The Live model's generated audio is never played:
// SageAI owns tools/history and the selected TTS speaker owns every reply.
(function (root) {
  'use strict';
  const MODEL = 'gemini-3.5-transcribe-live'; // Dedicated speech recognition, never a reply voice.
  const WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
  const workletURL = document.currentScript?.src
    ? new URL('sage-pcm-worklet.js?v=1.9.40', document.currentScript.src).href
    : 'src/js/sage-pcm-worklet.js?v=1.9.40';
  const prepared = new WeakMap();
  function joinText(committed, incoming, snapshot = false) {
    if (!committed) return incoming;
    if (!incoming) return committed;
    // Some transports send a cumulative hypothesis, others send new words.
    // Only remove an identical *prefix*: repeated words elsewhere are speech.
    const base = committed.trimEnd(), draft = incoming.trimStart();
    if (snapshot && draft.toLowerCase() === base.toLowerCase()) return committed;
    if (snapshot && draft.toLowerCase().startsWith(base.toLowerCase()) && draft.length > base.length
      && /^[\s.,;:!?)]/.test(draft.slice(base.length))) return base + draft.slice(base.length);
    return committed + (!/\s$/.test(committed) && !/^[\s.,;:!?)]/.test(incoming) ? ' ' : '') + incoming;
  }
  function prepare(context) {
    if (!context?.audioWorklet || !root.AudioWorkletNode) return Promise.resolve(false);
    if (!prepared.has(context)) prepared.set(context, context.audioWorklet.addModule(workletURL).then(() => true).catch(() => {
      prepared.delete(context); // a transient cold-load failure must not poison every later turn
      return false;
    }));
    return prepared.get(context);
  }
  function connect({key, pauseMs = 650, onText = () => {}, onBoundary = () => {}}) {
    let socket, ready = false, closed = false, failure = null, queue = [], queuedBytes = 0;
    let text = '', interim = '', ending = false, parked = false, receiving = false, boundarySeen = false, finalAfterEnd = false, finalWait = null;
    let settleTimer, deadline, connectTimer, boundaryTimer, turn = 0;
    let resolveReady;
    const connected = new Promise(resolve => { resolveReady = resolve; });
    const settle = () => {
      clearTimeout(settleTimer); settleTimer = null;
      if (!ending || !(boundarySeen || finalAfterEnd) || interim || !text.trim()) return;
      // Input transcription has no ordering guarantee against model output.
      // Allow late input segments to settle instead of submitting half a turn.
      settleTimer = setTimeout(() => finish(text.trim()), 180);
    };
    function finish(value) {
      clearTimeout(deadline); clearTimeout(settleTimer);
      settleTimer = null;
      const resolve = finalWait; finalWait = null;
      resolve?.(value || null);
    }
    function fail(problem) {
      const message = String(problem?.message || '');
      const status = Number(problem?.code || problem?.status || 0);
      const code = status === 429 || /quota|resource.exhausted/i.test(message) ? 'quota'
        : status === 401 || /API.?key.*(?:invalid|expired|not valid)/i.test(message) ? 'stt-auth'
        : status === 403 ? 'stt-access' : status === 404 ? 'stt-model' : 'live-unavailable';
      failure = new Error(code); ready = false;
      clearTimeout(boundaryTimer); boundaryTimer = null;
      clearTimeout(connectTimer); resolveReady(false); finish(null);
      queue = []; queuedBytes = 0;
      try { socket?.close(); } catch { /* disconnected */ }
    }
    function send(value) {
      if (!ready || closed || socket?.readyState !== 1) return false;
      try { socket.send(JSON.stringify(value)); return true; } catch { fail(); return false; }
    }
    function sendPCM(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return send({realtimeInput:{audio:{data:btoa(binary),mimeType:'audio/pcm;rate=16000'}}});
    }
    try {
      if (!key || !root.WebSocket) throw new Error('unsupported');
      socket = new root.WebSocket(`${WS}?key=${encodeURIComponent(key)}`);
      connectTimer = setTimeout(fail, 4000);
      socket.onopen = () => {
        if (closed) return;
        socket.send(JSON.stringify({setup:{
          model:`models/${MODEL}`,
          generationConfig:{responseModalities:['TEXT']},
          inputAudioTranscription:{languageCodes:['en-IN'],mode:'VERBATIM',
            // Domain terms only. Personal names biased a plain hello into
            // “Hello Viky”; recognition must never supply the addressee.
            customVocabulary:['SpinLog','KTM Duke','odometer','PUC','mileage']},
          realtimeInputConfig:{automaticActivityDetection:{disabled:false,
            startOfSpeechSensitivity:'START_SENSITIVITY_HIGH',endOfSpeechSensitivity:'END_SENSITIVITY_HIGH',
            // Local VAD already confirms 120 ms and keeps 500 ms of prefix.
            // A second 300 ms start gate would miss a short "hi".
            prefixPaddingMs:100,silenceDurationMs:Math.max(550,pauseMs)}},
        }}));
      };
      // Blob and string frames are both used by browser WebSockets. Serialize
      // decoding so a late Blob cannot overtake a newer text/final frame.
      let messages = Promise.resolve();
      socket.onmessage = event => {
        const arrivedIn = turn;
        messages = messages.then(async () => {
          if (closed || failure) return;
          const raw = typeof event.data === 'string' ? event.data : await event.data.text();
          if (closed || failure) return;
          const message = JSON.parse(raw);
          if (message.error) { fail(message.error); return; }
          if (message.setupComplete) {
            ready = true; clearTimeout(connectTimer); resolveReady(true);
            const pending = queue; queue = []; queuedBytes = 0;
            for (const pcm of pending) if (!sendPCM(pcm)) break;
          }
          const content = message.serverContent;
          if (!content || arrivedIn !== turn || parked || !receiving) return;
          if (content.inputTranscription?.text) {
            // Native Live emits incremental committed text, not a browser's
            // language-specific replacement hypothesis.
            const segment = content.inputTranscription.text;
            text = joinText(text, segment);
            if (ending) finalAfterEnd = true;
            interim = ''; if (!ending) boundarySeen = false;
            clearTimeout(boundaryTimer); boundaryTimer = null;
            onText(text.trim(), true); settle();
          }
          if (typeof content.interimInputTranscription?.text === 'string') {
            interim = content.interimInputTranscription.text;
            if (!ending) boundarySeen = false;
            clearTimeout(boundaryTimer); boundaryTimer = null;
            clearTimeout(settleTimer); settleTimer = null;
            onText(joinText(text, interim, true).trim(), !interim);
            settle();
          }
          // Committed words can arrive WHILE he is speaking. Only a provider
          // endpoint, or the caller's local pause + audioStreamEnd, ends a turn.
          if (text && (content.inputTranscription?.finished || content.generationComplete || content.turnComplete)) {
            boundarySeen = true;
            if (ending) { if (!settleTimer) settle(); }
            else if (!boundaryTimer) boundaryTimer = setTimeout(() => { boundaryTimer = null; if (!closed && !ending) onBoundary(); }, 180);
          }
          // Never consume outputTranscription/modelTurn as the user's words.
        }).catch(fail);
      };
      socket.onerror = fail;
      socket.onclose = () => { if (!closed) fail(); };
    } catch { fail(); }
    return {
      connected,
      bind(handlers) {
        // Each utterance gets new text/handlers, while the working transport
        // remains connected. Late frames while Sage speaks are ignored.
        turn++;
        clearTimeout(boundaryTimer); clearTimeout(settleTimer);
        text = interim = ''; ending = parked = receiving = boundarySeen = finalAfterEnd = false;
        onText = handlers.onText; onBoundary = handlers.onBoundary;
      },
      get available() { return !closed && !failure; },
      get failure() { return failure; },
      get text() { return joinText(text, interim, true).trim(); },
      push(buffer) {
        if (closed || failure || ending) return false;
        receiving = true;
        if (ready) return sendPCM(buffer);
        // Preserve first words during connection setup; never quietly discard
        // an overflowing prefix. The complete recording is the fallback.
        queuedBytes += buffer.byteLength;
        if (queuedBytes > 16000 * 2 * 5) { fail(); return false; }
        queue.push(buffer); return true;
      },
      async end() {
        if (closed || failure) return null;
        await connected;
        if (!ready || closed || failure) return null;
        ending = true;
        // The caller has detected a real pause. Already committed words are
        // usable without an extra model acknowledgement, but late finals still
        // get a short settling window and replace an interim hypothesis.
        if (text && !interim) boundarySeen = true;
        return new Promise(resolve => {
          finalWait = resolve;
          // A connected provider can remain silent. Close that unusable route
          // too, so every subsequent turn does not repeat the same wait.
          deadline = setTimeout(fail, 1800);
          if (!send({realtimeInput:{audioStreamEnd:true}})) { finish(null); return; }
          // A recent committed segment still gets a settling window; an old
          // partial must await a new final event or use the recorded fallback.
          settle();
        });
      },
      park() {
        turn++;
        parked = true; receiving = false;
        clearTimeout(boundaryTimer); clearTimeout(settleTimer);
        onText = onBoundary = () => {};
      },
      close() {
        closed = true; ready = false;
        clearTimeout(connectTimer); clearTimeout(boundaryTimer); resolveReady(false); finish(null);
        queue = []; queuedBytes = 0;
        if (socket) { socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null; try { socket.close(); } catch {} }
      },
    };
  }
  async function attach(stream, context, onPCM) {
    if (!await prepare(context)) return null;
    const source = context.createMediaStreamSource(stream);
    const node = new root.AudioWorkletNode(context, 'sage-pcm-capture');
    let active = true, flushed, stopping;
    node.onprocessorerror = () => { if (active) onPCM({failed:true}); };
    node.port.onmessage = event => {
      if (event.data.flushed) { flushed?.(); return; }
      if (active && event.data.pcm) onPCM(event.data);
    };
    // The processor outputs silence. Connecting it keeps capture active without
    // routing the microphone back into speakers or adding an echo.
    source.connect(node); node.connect(context.destination);
    return {
      stop() {
        return stopping ||= (async () => {
          let complete = false;
          try {
            complete = await new Promise(resolve => {
              const timer = setTimeout(() => resolve(false), 100);
              flushed = () => { clearTimeout(timer); resolve(true); };
              node.port.postMessage('flush');
            });
          } finally {
            active = false;
            try { node.port.postMessage('close'); } catch { /* failed processor */ }
            node.port.onmessage = null; node.onprocessorerror = null;
            try { source.disconnect(); } catch { /* already released */ }
            try { node.disconnect(); } catch { /* already released */ }
          }
          return complete;
        })();
      },
    };
  }
  root.SageTranscription = {prepare,connect,attach,MODEL};
})(typeof self !== 'undefined' ? self : this);
