# Sage cold-start and audio delivery fix — v1.9.41

Follow-up to the pipeline audit, based on merged `main`
`99d0bf5bd4158b3126bd26467a5a35001fdbf2eb`.

## Reproduced problems

- Before a cold AudioWorklet loaded, 100 ms of coarse microphone energy could
  mark startup noise as speech. Its following silence stopped the recording,
  flashed Processing and uploaded it for transcription. Unsolicited Live words
  could also pass that provisional gate.
- A genuine first word ending before classification started could be discarded
  when the first classified packet was quiet.
- A broken streaming response retried the same streaming route, leaving text
  without speech even when a complete-audio response was available.
- Valid WAV audio was rejected by the raw-PCM-only player. An attempted buffer
  flush counted as playback even when the audio source failed to start.
- An output context taking over 350 ms to resume, or suspending during synthesis,
  could miss playback. The subsequent microphone readiness update erased the
  audio-failure explanation.

## Result

The coarse meter now records only provisional activity. It cannot send audio to
Live or authorize its captions. Automatic cutoff waits for PCM readiness or the
existing bounded recorder fallback. If speech was not confirmed by the worklet,
the complete recording is checked locally with the bundled WebRTC detector
before showing Processing or uploading audio. Noise is discarded locally;
actual early speech retains the recorder's complete first-word prefix. An unused
Live stream is parked without waiting for a nonexistent transcript; failed
connections retain their existing cooldown.

Normal replies still stream for low latency. Before any source has started, a
transient audio failure gets one complete-response repair using the same text,
model, speaker, style and playback rate. Already-started speech is never repeated.
Mono 16-bit PCM WAV containers are parsed by their chunks before playback.
Suspended output contexts receive a bounded two-second resume opportunity,
including interruptions during synthesis. Persistent audio errors remain visible
through the next microphone startup. Quota/access errors retain their existing
limits; they do not substitute another voice.

## Verification

- Nine of ten targeted lifecycle cases fail on the unmodified merged main;
  the unsolicited-word safeguard already passes there. All ten pass with this
  patch. The complete deterministic suite passes all 176 tests.
- `audit-sage-startup-audio.mjs` delays real AudioWorklet loading by 2.2 seconds.
  Real Chromium MediaRecorder, decoding and local WASM classification reject
  startup fan noise without a Processing flash, provider request or chat turn.
  A recorded early first word is submitted once, receives actual Web Audio
  playback after a simulated stream failure, and returns to listening. A second
  reply resumes a real context suspended during synthesis without another request.
- Existing real microphone/Live, recorder recovery, audio sample continuity,
  docked controls, four centered turns, settings and stale-cache browser checks
  pass. Desktop, phone and small phone controls still fit.
- All 80 local references resolve; all 16 classic scripts and 12 startup handlers
  boot together. Changed JavaScript parses and the diff has no whitespace errors.

```sh
node --test tools/audit-sage-voice.mjs tools/audit-sage-controls.mjs tools/audit-sage-voice-latency.mjs tools/audit-sage-chat-command.mjs tools/audit-sage-pcm.mjs
node tools/audit-sage-startup-audio.mjs
node tools/audit-sage-live-browser.mjs
node tools/audit-sage-capture.mjs
node tools/audit-sage-audio-clock.mjs
node tools/audit-sage-docked-voice.mjs
node tools/audit-sage-voice-ui.mjs
node tools/audit-refs.mjs
node tools/audit-boot.mjs
```

Reviewed [Google's TTS documentation](https://ai.google.dev/gemini-api/docs/speech-generation)
for PCM streaming versus complete WAV responses and
[AudioContext.resume](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume)
for completion semantics. Provider replies in the tests are simulated. Actual
account quotas/access, rider microphone accuracy and subjective voice timbre have
not been verified. English-only replies and the selected voice remain in place.

HTML, worker, worklet and module URLs use v1.9.41. The worker cache is
`spinlog-cache-v1.9.41-voice33`.
