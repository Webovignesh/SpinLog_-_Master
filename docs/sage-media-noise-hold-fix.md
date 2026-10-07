# Sage media, noise and orb cancellation — v1.9.43

## Behavior

- `Play the last saved archive video` resolves the newest uploaded video from the actual inventory and opens the viewer, including a file hidden by filtering/pagination. `Open my driver's license` resolves the stored Driving License document and renders it in the same viewer. Images open as images, PDFs in an iframe. Other document formats retain the viewer's existing Open this file link.
- Opening/playing a file is distinct from reading its bytes for analysis. The new `open_stored_file` tool requires a current explicit request and an ID verified by a same-turn inventory/search result. `control_media_player` supports play/pause/next/previous/close. Existing page/form commands retain priority over file-name resolution. Pending/stale file signing cannot overwrite a later viewer.
- Video/audio uses the actual `HTMLMediaElement.play()` promise and paused state. Playback refusal leaves the viewer open and explains the real Play tap required by the browser. No false “playing” acknowledgement.
- The current voice call minimizes automatically, remains reachable above the file viewer, and moves above bottom playback controls. The orb remains draggable.
- WebRTC VAD still owns speech confirmation. Its shared wrapper learns RMS noise only from non-speech frames, preserves soft speech thresholds, and rejects narrow three-bin tonal concentrations such as hum/alarm tones. PCM samples are not modified. Both the live worklet and complete-recording validator use the same detector.
- Browser transcription hypotheses are deferred until local speech confirmation. If PCM is unavailable or the speech preceded cold worklet startup, the complete recorded prefix is validated locally before a native transcript can become an AI/tool turn. Rejected noise never becomes an actionable command.
- Hold the orb for **550 ms** to abandon the current turn. Session/capture tokens invalidate late callbacks, STT/model requests abort, queued speech stops, and the same enabled microphone resumes through Connecting to Listening. The selected TTS speaker/model/rate/style remain intact. Muting/backgrounding remain respected. Moving 8 px cancels the hold; short taps retain their previous behavior. Holding the dock does not expand it. Escape while the orb has focus also cancels.
- Cache v1.9.43 / voice35 refreshes the classic scripts, worklet and its transitive VAD module together.

## Validation

**200 deterministic tests pass.** The suites cover media permission/ID guards, licence aliases, pre-pagination media type selection, honest playback failures, cancellation freeing the provider request lane, no stale reply/history after hold, drag/short-tap separation, native background hallucinations, complete-recording noise rejection, 100/440/997/2200 Hz background tones and quiet first-word speech with a fan floor. Existing voice-loop, recording, text, quota, PCM continuity and selected-speaker regressions remain included.

Chromium exercises the production viewer with fixture images/PDFs and real HTML media playback, including autoplay refusal and canceled signing, on desktop/mobile. The docked-call audit uses the real pointer hold and router at desktop, mobile and small viewports; it verifies the same microphone, no expansion and no stale response. Real microphone/worklet and cold-start recorder audits exercise English speech, silence/noise rejection and playback handoff. Provider responses are simulated: this does not measure live-provider word error rates, the user's microphone, or every real environment. A nearby human voice or background TV speech cannot reliably be separated by ordinary VAD; this patch does not claim speaker identification.

Commands:

```sh
node --test tools/audit-sage-voice.mjs tools/audit-sage-controls.mjs tools/audit-sage-voice-latency.mjs tools/audit-sage-chat-command.mjs tools/audit-sage-pcm.mjs
node tools/audit-boot.mjs
# Set PLAYWRIGHT_CHROMIUM_EXECUTABLE if using an externally installed Chromium.
node tools/audit-sage-media.mjs
node tools/audit-sage-docked-voice.mjs
node tools/audit-sage-live-browser.mjs
node tools/audit-sage-startup-audio.mjs
node tools/audit-sage-voice-ui.mjs
```

No production data or files are modified by these audits. Existing upload gestures and deletion confirmations are unchanged.

Primary references consulted: [MDN play()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play), [autoplay guidance](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay), and [noise suppression settings](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/noiseSuppression).
