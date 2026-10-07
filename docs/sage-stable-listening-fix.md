# Stable Sage listening — v1.9.44 / voice36

Two failures reproduce on the merged v1.9.43 code:

1. Six consecutive 100 ms packets containing only 20 ms of VAD activity each reach the old 120 ms counter. Background spikes become an utterance, recording stops, and the UI enters Processing without a useful transcript.
2. Every 15 seconds of silence, `startGeminiListen` cancels the capture and attaches a new worklet. This visibly returns through Connecting, creates a new detection window, and can interfere with the next first word even though the microphone stream itself is reused.

The new onset uses a bounded 400 ms window, at least 120 ms of classified speech, and at least 40% speech density. Leading silence is trimmed from that window. Brief inter-packet gaps do not erase all the speech accumulated so far; very sparse background classifications do not qualify. Continuation requires at least 30% of a normal packet (capped at 30 ms). The default breathing pause and selected TTS voice remain unchanged.

During healthy silent capture, only the compressed MediaRecorder is rotated. Its old callbacks are detached; final old recorder data cannot enter the new recording. The worklet, local VAD, native/Live route, microphone and readiness state keep running. Pre-utterance PCM is bounded to 600 ms, enough for the 500 ms Live pre-roll plus current packet. Once speech or a cold prefix candidate starts, its complete audio is retained. Rollover errors pause with an actionable message rather than leaving a silently broken recorder. A failed/unavailable PCM path retains its existing recovery behavior.

Validation:

- **203 deterministic tests pass**, including three new regressions: sparse background classifications followed by speech, a minute of silence without worklet/socket recreation or UI phase changes, and quiet fragmented first words after leading silence.
- The first two new tests fail against merged main and pass with this patch.
- Chromium real microphone/worklet test waits through an actual silent recorder rollover, verifies no Connecting/Processing transition, then completes seven spoken turns using one microphone. It checks exact streamed-audio preservation in the recorded fallback.
- Chromium cold-start recorder/VAD tests pass for rejected noise and a real first-word prefix.
- Shared-script boot and whitespace checks pass.

Commands:

```sh
node --test tools/audit-sage-voice.mjs tools/audit-sage-controls.mjs tools/audit-sage-voice-latency.mjs tools/audit-sage-chat-command.mjs tools/audit-sage-pcm.mjs
node tools/audit-sage-live-browser.mjs
node tools/audit-sage-startup-audio.mjs
node tools/audit-boot.mjs
```

Provider responses are simulated; these checks reproduce lifecycle/detection faults but do not measure the user's microphone or live-provider word error rates. No production data was changed. This patch is based on the merged PR #23 and preserves its media controls and orb hold cancellation.
