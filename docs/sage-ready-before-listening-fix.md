# Sage startup readiness and loop fix — v1.9.45

The earlier 1.5-second audio deadline could abandon an AudioWorklet that was still loading. Meter activity could then end a provisional turn before capture and recognition were ready. The recorded fallback silence path also recreated capture every 15 seconds.

## Changes

- Audio frame startup and Live setup allow up to eight seconds before fallback. Successful setup becomes ready immediately; no fixed startup sleep is added.
- A single capture readiness flag gates both automatic endpoints and manual commits. Connecting stays visible until the microphone has started and audio/recognition are usable. The instruction asks the user to wait for Listening.
- A settled startup volume candidate is decoded and checked locally while capture remains active. Noise clears the candidate without processing, uploading, restarting the microphone or creating a conversation. Confirmed early speech uses the full recording, preserving its first syllable. New classified speech or captions supersede the provisional check.
- Both streaming and recorded fallback silence rotate only MediaRecorder every 15 seconds, keeping the capture owner, microphone and readiness state. A stopped recorder and failed local speech detector pause explicitly for a user retry rather than cycling automatically.
- English-only synthesis, selected speaker, accent configuration, media controls and orb hold cancellation are unchanged. Asset caches advance to v1.9.45/voice37.

## Validation

207 deterministic tests cover voice transitions, cancellation, captions, controls, PCM capture, recognition fallbacks and latency. New regressions cover warm-up beyond the old deadline, speech while Live setup is pending, detector failure and a minute of fallback silence.

Chromium startup checks use real MediaRecorder, audio decoding, shared speech detection and Web Audio playback with a 2.2-second worklet load. Background noise creates no provider request or invented turn. An early real recorded English word produces exactly one turn and audible scheduled output; interrupted playback context recovers.

The Live browser audit checks actual silent recorder rollover, seven voice turns and visible state transitions. Provider responses are simulated in these browser tests. Real microphone hardware and provider latency were not measured; this change does not guarantee transcription accuracy or availability. A local startup check that cannot complete pauses with a retry instruction instead of claiming readiness or repeatedly reconnecting.
