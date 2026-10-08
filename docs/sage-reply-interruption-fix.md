# Sage reply cancellation — 1.9.49

## Reproduced failure

On merged main, the local interruption monitor could cancel a pending answer
after 180 ms of microphone frames without first observing a fresh speech start.
It accepted a packet with only 40 ms classified as speech. Continued speech
after submission and minority speech classifications both reproduced a silent
return to listening, leaving only the user turn on screen.

This matches the reported symptom, but the screenshot alone cannot identify the
device's exact cancellation cause. The regression is demonstrated in isolated
tests; physical-room background voices and echo still need a device check.

## Fix

- Arm spoken interruption only after 240 ms of quiet or matched assistant echo.
  Old trailing/buffered speech cannot cancel the pending answer or seed the next
  command. The speaking hint offers verbal interruption only after arming.
- Require 180 ms of classified and active speech above the existing noise floor,
  with at least 60% speech density in the recent 400 ms window. This tolerates
  natural syllable gaps while rejecting minority classifications. Once armed,
  a deliberate interruption still
  cancels the old turn and transfers the microphone and first-word prefix.
- A false playback-completion result is treated as an audio failure, rather
  than acknowledging a spoken reply and immediately resuming listening.
- Expose the armed flag in local diagnostics, without storing words, audio or
  keys. Change only the voice script URL/cache to load the correction promptly.

The speaker, TTS model preference, accent/style, speech rate, normal recognition,
long-turn breathing window and website controls are unchanged. The app-method
updates excluded from #28 remain outside this focused hotfix.

## Validation

`node --test tools/audit-sage-reply-recovery.mjs tools/audit-sage-pcm.mjs tools/audit-sage-voice-latency.mjs`

The two new cancellation regressions fail on the previous voice source and pass
with the fix. The focused tests also cover legitimate interruption before and
during playback, preservation of the existing microphone, stale-answer rejection
and waiting for actual source completion. The existing lifecycle harness is
reused without modifying its fixtures.

All six focused regressions pass, plus 43 PCM/model-latency checks (49 unique
checks). The cold-start browser scenarios pass. The final real-PCM conversation
audit interrupted in 309 ms, passed speaker echo/tail rejection and listening
recovery, retained one microphone, and accepted a command longer than 45 seconds;
the PCM callback p95 was 0.7 ms. These timings describe the local fixture only.
The docked-call browser audit also passes at desktop, mobile and small viewport
sizes without page errors.

Chromium audits use real MediaRecorder, Web Audio, the PCM worklet and VAD, with
simulated provider messages. They verify cold first words, streaming-audio repair,
interrupted output recovery, speaker echo/tails, speech interruption and a turn
longer than 45 seconds. These are local regressions, not provider latency or
physical echo guarantees. Before merging, test one Hello from cold start, several
quiet replies, background noise, and deliberately talking over a reply.

Reviewed [Gemini TTS documentation](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation)
and [Web Audio completion events](https://developer.mozilla.org/en-US/docs/Web/API/AudioScheduledSourceNode/ended_event).
