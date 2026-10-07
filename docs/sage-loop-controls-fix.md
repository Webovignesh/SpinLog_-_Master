# Voice loop and site controls — v1.9.42

## Behavior

- Connecting stays visible until microphone recording, audio packets and the recognition route are ready. Listening reflects actual capture readiness. Processing covers transcription, reasoning and speech preparation; Replying starts when audio plays. After playback finishes, capture resumes automatically, without an intermediate idle message. Muting, closing, backgrounding and browser audio restrictions keep their existing explicit recovery paths.
- The default end-of-speech pause is 900 ms. Quick (650 ms) and Relaxed (1,200 ms) remain selectable. Continued speech resets the pause. Server transcription finals and browser recognition disconnects cannot bypass it. Browser recognition reconnects within a turn and preserves committed words across the reconnect.
- Sage can inspect and click visible site buttons; type into visible fields; select real dropdown options; operate switches and sliders; and scroll a page or an owned dialog. Commands such as “click Inspect totals then slide Volume to 0.7” use the local command route when their labels are unambiguous. Ambiguous requests use the model with a fresh catalog of actual controls.
- `show_record` opens and highlights a verified service record, archive item or document while a voice answer continues from the minimized orb. Service and archive records can open their existing editor when explicitly requested. Service presentation clears excluding filters, reveals the correct results page and waits for rendering. Archive presentation uses the existing media pager's `reveal` API.
- “What is my costliest mod?” deterministically presents the winner from the aggregate over all matching mods, even if it is older than the returned records page. Tied records remain in the facts returned to Sage; the first tied record is highlighted. A blocked dialog prevents presentation without discarding the factual answer or an open draft.

## Boundaries and failure handling

Opaque UI handles resolve only to currently visible, enabled controls on the active section or an owned dialog. Hidden, removed, credential and file-picker controls are excluded. Unknown dialogs and deletion confirmations block underlying controls. File selection still uses the real Choose file gesture; deleting data retains the existing confirmation. A click alone never reports that a record was saved. Record forms remain drafts, while existing settings and filter handlers may apply immediately.

Read proofs and cancellation are shared across tool calls in one model turn. Record presentation requires an id returned by that turn's read/search tools. Greetings, negated UI requests, stale ids and cancelled turns cannot open a record. The selected TTS speaker, model, rate, accent instruction and retry route are unchanged.

## Validation

The deterministic suites cover the complete four-turn loop, an early server final, breathing/continued speech, browser disconnect/reconnect, playback completion, muted/backgrounded/closed sessions, read-proof scope, cancellation, costliest-mod ties beyond pagination, blocked presentation and render completion.

186 tests pass with:

```sh
node --test tools/audit-sage-voice.mjs tools/audit-sage-controls.mjs tools/audit-sage-voice-latency.mjs tools/audit-sage-chat-command.mjs tools/audit-sage-pcm.mjs
```

Eight targeted new regressions fail against the parent main commit `a687d32235a3a1fb0825d84566e0c16e74c5b816` and pass with this change. The showroom-versus-mods comparison regression additionally checks that the winner workaround does not narrow unrelated comparisons.

Chromium audits use the production UI, Web Audio, microphone recording, PCM worklet/VAD, Live protocol, router, service pager/filter/render functions, record presentation and editors with local fixture records. They check repeated turns with one microphone/speaker, cold noise versus first speech, streaming continuity, desktop/390px/320px layouts, local click/type/switch/slider/scroll commands, off-page highlights during spoken replies, modal isolation, file-picker gestures and flash-free closing. Provider captions and generated speech are simulated; these checks do not measure a live account's network latency or transcription accuracy.

The Live-browser, startup-audio, capture, docked-voice, voice-UI and audio-clock Chromium audits pass. The app boot audit and `git diff --check` pass. No production account records were written or deleted during testing.

Release cache: `spinlog-cache-v1.9.42-voice34`. Versioned page/worker/worklet URLs are updated together so an older cached voice controller cannot override the loop.

## References reviewed

- [Gemini Live transcription](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe)
- [Gemini Live activity detection and audio stream end](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
- [Browser recognition end event](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/end_event)
- [Web Audio context states](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state)
