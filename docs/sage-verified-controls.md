# Sage verified website controls — 1.9.48

This stage builds on the device-tested conversation foundation merged in #27.
It changes app controls and their acknowledgements. Capture, transcription,
PCM playback, VAD, voice identity and interruption timing remain unchanged.

## Behaviour

- Scrolls wait for the actual position before another step starts. “Scroll down
  two times”, small/large steps and explicit command chains work in sequence.
  At an edge, Sage reports the boundary instead of claiming movement.
- An open dialog scrolls its visible content, never the page behind it. Current
  scroll surfaces have inspectable handles. Stale handles and changed surfaces
  fail rather than moving an unrelated page.
- Cancelling a voice turn stops an in-progress scroll. Navigation checks the
  same cancellation callback before its delayed page swap or history update.
- Navigation verifies the active section. It closes the owned media viewer or
  settings panel first; an open record draft or confirmation blocks navigation
  and remains available for review. “Close form then open documents” is explicit.
- Clicking an archive file or document waits for the owned viewer. Next/previous
  viewer buttons use the actual player operation. Normal external links remain
  outside the page-control inventory.
- Named archive searches filter the complete collection before pagination.
  Document inventories include their uploaded file name. Ambiguous matches ask
  for the exact file rather than selecting an arbitrary upload.
- Page/file/playback commands share a local chain: for example, “open documents
  then play sample-clip.mp4 then pause video then go to home”. Each step uses
  freshly inspected controls; a failed step stops the rest of the chain.
- Imperative UI acknowledgements come from action receipts, even if a model
  supplies a false completion claim or a follow-up model request fails. Factual
  answers retain their prose. Existing data-write results are handled separately.
- Form fills dispatch existing handlers and verify accepted values. They remain
  drafts. A generic button receipt says “Pressed”, not “Saved”. Pager actions
  check that the results page really changed. Disabled custom options are excluded.
- Upload preparation reports “choose the local file”; it never claims a completed
  upload without an upload result. Browser file selection and app delete
  confirmations keep their existing user interaction.

## Validation

`tools/audit-sage-actions.mjs` uses synthetic fixtures in Chromium with production
router, controls, tools and AI routing. It covers real smooth scrolling, nested
dialogs, cancellation, stale controls, blocked navigation, awaited file opening,
command chains, old archive files, draft receipts, pager no-ops and false model
acknowledgements. Provider responses are simulated; no account or stored file is
used. Existing controls, media and voice integration audits supplement it.

Validated locally: 15 new browser regressions and 37 existing controls/media/
conversation checks passed. Docked-call and voice-UI audits passed at desktop,
mobile and small sizes. All 80 local asset references resolved; changed scripts
parsed; the four voice engine files matched merged main byte for byte.

Run with an installed Chromium executable when needed:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium node --test tools/audit-sage-actions.mjs
```

The app release/cache is 1.9.48; only changed scripts get new URLs. Unchanged
voice assets retain their 1.9.47 URLs and diagnostics version. Browser playback
permission, provider recognition/latency and physical-device echo still require
device checks. This stage does not promise arbitrary external-site control or
access to local files the user has not selected.

Before merging, check a docked call on the target device: repeated scrolling,
opening and playing a saved file, opening Home from the viewer, changing a visible
dropdown/field, and interrupting a command while it is running.
