# Sage recorder and audio interruption fixes — v1.9.46

The deployed site was checked and served v1.9.45; PR #25 was merged. This follow-up addresses additional failures, rather than assuming the user was on an old build.

## Reproduced defects and changes

1. **Unexpected MediaRecorder stop.** The stop handler called the normal completion path even when the local endpoint had not requested a stop. In silence, this recreated capture and returned to Connecting; during speech it could process a partial command. Initial and rolled recorders now require an explicitly stopping capture before completion. An unexpected current-recorder stop pauses with a clear retry instruction. Cancelled/obsolete recorder events are ignored.
2. **Suspended reused microphone context.** Returning the existing microphone stream skipped audio-context recovery. A call could continue with an inactive meter/worklet. Capture resumes the context before reusing the stream, and readiness checks require running audio. Interruption during capture attempts one bounded recovery, waits for a fresh audio packet, then pauses if audio cannot resume. Manual commits cannot bypass suspended audio.
3. **Suspension during playback.** Resuming only before scheduling audio did not cover a device interrupting an already-playing reply. Playback now observes context state and resumes the same scheduled samples; it does not generate a new performance or change the speaker. A blocked device reports audio failure and pauses; completed/cancelled playback removes the observer.
4. **Startup noise discarded the fast recognizer.** Any coarse meter activity during a slow module load marked a recording gap and immediately closed Live. The healthy connection now stays available while local prefix validation runs. Rejected noise clears the provisional gap, enabling live captions on the same mic. Confirmed early speech still uses the full recorder prefix.
5. **Short first words were discarded.** A brief meter prefix could end before the 100 ms coarse activity timer qualified it. The complete prefix is now checked locally regardless of that coarse duration. Classified streaming speech can also start at 80 ms when at least 80% of its onset window is voiced; the existing 120 ms/40% route retains fragmented soft speech. Sparse-background and tonal-noise checks remain in place. The shared detector itself is unchanged.

## Diagnostics

`SageVoice.diagnostics()` returns the version, visible phase, microphone/recorder/context readiness, active route/gap flags, and the most recent 80 local events. Events include readiness changes, first PCM, classified speech onset, recorder pauses, recognition setup outcomes and reply HTTP/error codes. It does not contain transcripts, recorded audio, API keys or request bodies; nothing is uploaded. Returned events are copied so consumers cannot modify the internal log. The UI continues to use its existing hint for recovery instructions.

## Validation

219 deterministic tests pass across voice lifecycle, controls, chat commands, latency, real PCM resampling and shared VAD. Before the change, three new lifecycle reproductions failed: unsolicited stops in silence, unsolicited stops during speech and a suspended reused context. Additional cases cover mid-playback recovery/blocking, interruption during capture, private diagnostics, short first words and short cold prefixes. Real English speech is validated at 100%, 15% and 6% amplitude; silence, fan, click, DC and concentrated tones remain rejected.

Chromium checks use real MediaRecorder, audio decoding, WebRTC VAD and Web Audio, with simulated provider responses. Cold module startup, noise rejection, an early recorded word, unexpected recorder stop, suspension during synthesis and actual suspension during playback are checked. The streaming browser audit covers 15.5 seconds of silent recorder renewal and seven turns with one speaker and cleanup. Real API access, quota, hardware microphone behavior and end-user browser accuracy are not established by these tests. The added diagnostics distinguish those failures instead of presenting test counts as proof that every device is fixed.

The API setup and speech-output schema were reviewed against Google's current [Live transcription guide](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe) and [GenerateContent TTS guide](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation). No provider model, configured speaker or accent instructions were changed. Cache and dependent modules advance together to v1.9.46/voice38.
