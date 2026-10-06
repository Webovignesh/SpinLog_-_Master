# Sage voice pipeline audit — v1.9.40

Audited against `main` commit `d26e943170aef92ad703d319e3e1fb946dc7c56d`.
Scope: microphone startup, speech detection, Live and recorded transcription,
English browser recovery, captions, app actions, reply generation and playback.

## Confirmed defects and fixes

| Priority | Evidence / previous behavior | Result in this patch |
| --- | --- | --- |
| P0 | PCM capture could stall after its first packets without a processor error. The silence timer then used the meter, but fallback still uploaded the incomplete PCM instead of the full recording. | A gap over 500 ms invalidates that turn's PCM/Live route. The complete MediaRecorder recording, including its final chunk, is transcribed once. |
| P0 | A worklet flush timeout was treated as success. The final buffered syllable could be missing. | Stop is idempotent and reports whether flushing actually completed. An unacknowledged flush or stop failure uses the full recording. |
| P1 | Local speech confirmation required 120 ms; server start detection additionally used `prefixPaddingMs: 300`. Short first words could wait for more speech. | Server start confirmation is 100 ms. The existing local 120 ms speech gate and 500 ms retained prefix still reject startup noise and preserve the opening syllable. |
| P1 | Committed `Open` plus draft `the service page` displayed `Openthe service page`. A cumulative draft duplicated the committed prefix. | Drafts have word boundaries; cumulative prefixes tolerate leading spaces/casing changes. Committed segments remain incremental, preserving spoken repetitions. Final text is assembled before a draft in the same message. |
| P1 | A delayed WebSocket Blob queued before parking could finish decoding after the socket was bound to a new turn. | Frames carry the turn generation from arrival; queued captions from an older turn are discarded. Working sockets are still reused. |
| P1 | Browser recovery waited only 220 ms after stopping and resolved immediately on `onend`, losing a later final transcript. | Wait up to 900 ms for an outstanding final; a complete final settles in 40 ms. The interim is never executed. A 350 ms late-final regression submits exactly once without another audio upload. |
| P1 | The initial browser start had a watchdog, but a restart after no-speech did not. | Every start/restart gets the same two-second readiness deadline. Service errors retain cooldowns instead of starting a reconnect loop. |
| P1 | A configured key in whole-key cooldown looked like a missing key and prevented voice startup, including free local UI commands. | Configured keys and currently usable keys are distinguished. Supported English browser input can continue during cooldown; API calls still respect the cooldown. Missing/rejected/quota states have distinct hints. |
| P1 | Navigation tools were declared only for one exact whole-turn command. `open service and then open documents` could not authorize either action. | Explicit clauses authorize their own action/destination. Up to six recognized UI steps execute locally in order, re-inspecting fields after navigation/menu changes, and stop on failure/cancellation. Ordinary questions still use the model. |
| P1 | The model had no initial snapshot of visible fields/choices/actions. Broad form guards could block notes containing “don't” or allow an unrelated UI action. | Model context includes current owned controls. Exact requests constrain arguments. Field values and quoted command-like notes remain data. Historical, hypothetical and negated command mentions cannot close the call. |
| P1 | Page controls could edit CSS-invisible fields or activate controls behind an unlisted media/confirmation dialog. | Visibility and active-dialog checks cover owned dialogs and confirmations. Available actions are reported; blocked actions return an error. Filter toggles verify their actual state. Search locates its real owning section from the DOM. |
| P2 | A leftover Tamil suffix formatter changed English `Plan-A`/`vitamin-a`. The speech formatter removed every underscore, changing filenames, while the orb displayed raw Markdown. | Removed the obsolete suffix rewrite. Voice display/speech share plain-text formatting that preserves English compounds and filenames, including internal double underscores. The full chat reply stays intact. |
| P2 | Live captions silently discarded everything except the last 200 characters. | Full captions remain in the DOM inside a bounded, scrollable caption area. The four centered conversation rows and minimized orb are retained. |

## Website capability coverage

| Request | Actual mechanism / boundary |
| --- | --- |
| Open Home, Service, Documents or Chat; Back/Next | Existing in-app router/history tools. Navigation docks the ongoing call; Home aliases resolve to `home`. |
| Minimize, expand or close voice; open settings | Existing voice/settings methods. Only explicit current requests authorize these changes. |
| Fill a form or select a dropdown | Owned visible inputs, real custom/native dropdown handlers, validated dates/numbers and legal choices. For example: `open service form and select Showroom and set cost to 450`. |
| Search/filter/page results | Existing search and history controls plus app search/read tools. Unavailable controls fail honestly. |
| Save or update app data | Existing service, cover, document, media, parking, reminder and memory data tools. Filling a field alone remains a draft; it does not claim a save. |
| Read stored documents | Existing paginated document readers pass actual attachments to the model and report missing/failed files. |
| Upload a local file | Prepares the owned picker/form; the user chooses the file through the existing browser gesture. No invented upload completion. |
| Destructive changes | Existing app confirmation remains required. Underlying fields cannot be edited through a confirmation dialog. |

## Verification

The targeted regressions were also run against the unmodified audited commit:
all 12 selected cases failed there and pass with this patch. This distinguishes
reproduced failures from observations about provider accuracy.

```sh
node --test tools/audit-sage-voice.mjs tools/audit-sage-controls.mjs tools/audit-sage-voice-latency.mjs tools/audit-sage-chat-command.mjs tools/audit-sage-pcm.mjs
node tools/audit-sage-live-browser.mjs
node tools/audit-sage-capture.mjs
node tools/audit-sage-docked-voice.mjs
node tools/audit-sage-voice-ui.mjs
node tools/audit-refs.mjs
node tools/audit-boot.mjs
```

- 164 deterministic tests: capture/final chunks, noise gate, draft/final ordering,
  stale frames, timeouts, quota recovery, cancellation, English replies, tools and
  sample continuity. All pass.
- Real Chromium microphone, AudioWorklet/VAD, MediaRecorder, decoding/WAV and
  playback paths; delayed setup, repeated turns, silent-provider fallback and
  cleanup pass with simulated provider responses.
- Desktop 1280×900, phone 390×844 and small phone 320×568: real routing,
  compound dropdown/form drafting, active-dialog boundaries, upload preparation,
  draggable orb, four turns, focus, settings typography and cache upgrade pass.
- All 79 local asset references resolve. All 16 classic scripts and 12 startup
  handlers boot in one shared global. Changed JavaScript parses; diff has no
  whitespace errors.

## API checks and remaining limits

Reviewed primary documentation:

- [Google Live transcription](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe)
  for interim/final transcription and 16 kHz mono PCM streaming.
- [Google Live API reference](https://ai.google.dev/api/live)
  for speech-start detection, `audioStreamEnd`, reopening the same stream and
  transcription ordering.
- [SpeechRecognitionEvent.results](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionEvent/results)
  for cumulative final results and replaceable interim hypotheses.

Google's actual recognition accuracy, service access/quotas, network latency and
subjective timbre were not tested with a real account or the rider's microphone.
The existing selected TTS speaker, saved model and playback rate stay pinned;
there is no browser voice substitution or new accent prompt. These checks verify
the application's lifecycle and audio delivery, not identical provider-generated
timbre on every request. Replies remain English-only; Tamil input aliases for
existing page/voice commands do not restore Tamil speaking.

No speech recordings from the rider are committed. Test speech and provider
responses are synthetic. HTML, worker, worklet and module URLs share v1.9.40;
the service-worker cache is `spinlog-cache-v1.9.40-voice32`.
