# Sage long commands and spoken interruption — v1.9.47

This is the first stage of the Jarvis plan: conversation timing and cancellation. Website control improvements are a separate stage. The base is main at `3d65d1bd670d9a9523adb9ee1dba3f8ca728d501` (v1.9.46). Keep this change on `feat/sage-conversation-turns` until physical microphone/speaker checks pass.

## Behavior

The normal Connecting → Listening → Processing → Replying → Listening loop remains. Connecting means capture is preparing; Listening requires the existing capture readiness checks. Short requests retain the selected 650/900/1200 ms pause. Once a turn has lasted eight seconds, reached 24 caption words, or ends in an unfinished connector such as “and” or “then”, the pause becomes 1600/2200/2600 ms respectively. Continued speech resets the pause. A provider final cannot bypass it.

Long-command mode removes the old 45-second forced submission. It accepts up to two minutes from the start of detected speech. At the resource limit, it discards the unfinished turn, submits nothing, and explicitly asks the user to split the command. It does not pretend to support unlimited dictation or execute the last fragment. Silence still rotates only the recorder under the existing lifecycle rules.

Speaking during transcription, reasoning, or a reply can cancel that turn. A local PCM detector requires 180 ms of consecutive classified, audible speech; volume alone is insufficient. Cancellation invalidates the session, aborts pending STT/model/TTS requests, stops queued audio, and rejects late callbacks. It cannot undo an action already completed before interruption.

The detector keeps a maximum 600 ms prefix in memory and transfers its active worklet and microphone to the new utterance, preserving the first words. A newly started browser recognizer cannot replay that prefix, so an interrupted utterance uses complete PCM or Live transcription. If PCM fails and the compressed recording lacks the prefix, Sage asks for the entire request again instead of executing a fragment.

The selected TTS speaker, model selection, playback rate, and English voice instructions are unchanged. No Tamil output or browser TTS is added.

## Echo and recovery

The interruption detector processes microphone audio locally; it does not stream it to a provider while Sage replies. The browser's existing echo cancellation remains requested. An additional normalized correlation compares incoming PCM with scheduled reply PCM, including playback rate and up to 400 ms of delay. Worklet packets carry audio-clock end times so main-thread delivery delays do not change the comparison. A submillisecond search and sample-level refinement avoid missing the reply waveform's phase. Matched echo cannot trigger interruption or become the next command's prefix; the same filter rejects reply tails after listening resumes.

Detector initialization failure, missing speech classification, and stalled packets disable spoken interruption for that reply without cancelling working playback. The existing orb remains available. Mute and hidden tabs release the monitor; returning to a pending reply rearms it once. A completed reply transfers a healthy monitor into listening without reopening the microphone. The ready speaking hint changes to “Speak to interrupt. Hold the orb to cancel.” only after classified PCM is arriving.

Both features default on and have independent Sage settings: **Long commands → Fixed pause** restores the previous recording/pause behavior; **Speak to interrupt → Use the orb** disables the background detector. Tap/hold cancellation remains available. Cache, capture modules, UI assets, and diagnostics advance together to v1.9.47/voice39.

## Validation

Run deterministic regressions:

```sh
node --test tools/audit-sage-voice.mjs tools/audit-sage-pcm.mjs tools/audit-sage-voice-latency.mjs tools/audit-sage-controls.mjs tools/audit-sage-chat-command.mjs
node tools/audit-boot.mjs
node tools/audit-refs.mjs
git diff --check
```

The conversation additions cover a 50-second command, resumed breathing pauses, incomplete clauses, the two-minute limit, interruption during STT/reasoning/playback, late response rejection, first-word transfer, PCM failure, echo/noise/spikes, mute/close/background recovery, detector failure, and 20 consecutive turns. The existing fixed-pause/orb-only baseline remains covered. Worklet checks validate sample continuity and audio-clock timestamps at 16/44.1/48 kHz.

All 231 deterministic checks passed, along with boot/reference audits and all five browser audits below. The final Chromium fixture run interrupted playback in 403 ms; the measured PCM handler's 95th percentile was 0.9 ms. These are local test results, not a latency guarantee for the user's hardware or provider.

Browser checks require Playwright/Chromium; the new conversation audit also requires FFmpeg with the `flite` filter:

```sh
node tools/audit-sage-conversation.mjs
node tools/audit-sage-startup-audio.mjs
node tools/audit-sage-live-browser.mjs
node tools/audit-sage-voice-ui.mjs
node tools/audit-sage-docked-voice.mjs
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an installed Chromium executable. The new audit uses real MediaRecorder, Web Audio, the production PCM worklet, and bundled speech detector. It verifies a 47-second utterance, breathing space, an interruption while real PCM plays, one microphone, delayed/gain-scaled speaker echo, reply-tail rejection, and listening recovery. Provider text/audio responses are fixtures; these checks do not establish live transcription accuracy, account latency, quota, or physical room echo cancellation. The echo audit initially reproduced false interruption with the coarse delay matcher; the audio-clock and finer matching fix passes that reproduction.

## Device checks before merge

1. Open the call from a cold tab. Stay silent until Listening; then say a short greeting once. No invented command or startup processing should appear.
2. Give a 60–90 second request with short pauses and a correction. Expect one complete transcript/request and extra breathing space before Processing.
3. Speak “actually, open Home instead” over a long reply, then during a pending answer. The old work/audio must stop and the correction must retain “actually”. Repeat quietly with headphones and with phone speakers.
4. Let Sage speak without talking: her own voice, fans, taps, and room echo must not interrupt or become a new command. Test lower user volume while she speaks; waveform correlation is supplemental filtering, not a guarantee for every room/device.
5. Complete at least 20 turns, mute/unmute during a reply, switch tabs, minimize/restore, hold to cancel, and end the call. Check listening recovery, speaker consistency, and resource release.
6. Disable each new setting independently and confirm the retained orb-only/fixed-pause modes still work. Test the two-minute limit on a harmless dictation: nothing should execute.

If these fail, keep the branch unmerged and attach local `SageVoice.diagnostics()` output. Diagnostics contain transitions and route/readiness flags, not speech, names, API keys, or recorded audio.

References reviewed: [Gemini Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities) and [browser echo-cancellation constraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation).
