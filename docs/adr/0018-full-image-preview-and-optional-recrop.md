# ADR-0018: Full-image preview and optional recropping

- Status: accepted
- Date: 2026-09-05
- Refines: D24, D37, ADR-0009 and ADR-0011

## Decision

Selecting an image generates the first pattern from its complete bounds, with no mandatory crop
screen or inferred subject selection. A labelled secondary action next to the preview opens a crop
dialog. Moving the rectangle is a draft-only change; cancel leaves the pattern intact. Confirmation
automatically regenerates, asking first if it would replace manual work. Reselecting a missing
original also asks before replacing any existing pattern, including restored manual work.

The decoder retains compressed original bytes and a bounded preview for this browser session only.
Switching designs, importing, resetting, decode/generation failure and unmount invalidate late
operations and release original resources. Refresh and cross-device access do not restore originals.
Missing originals are explained honestly; an 800px local generation source is never presented as
the original. No new image data enters server APIs, project files or cloud synchronization.

A source replacement is staged inside the generation session. Success commits the new pattern and
source together; failure/cancellation restores the previous pair. Undo restores the matching source
and crop rectangle, including clearing the source if the prior pattern was source-less. Only a
successful pair enters atomic IndexedDB persistence, including conflict-copy writes. This supersedes
the old reselect-and-cancel behaviour which could bind a new source to an unchanged restored pattern.
Restoring an already matched local source remains an immediate binding operation.

Mobile cropping occupies the actual visual viewport, respecting safe areas, rotation, browser zoom
and reduced visible height. The image stays bounded and proportional; buttons have 44px targets.
Single-finger gestures on the crop canvas adjust the draft rectangle; adding another pointer or
pointer cancellation abandons that gesture and preserves browser pinch zoom. Keyboard movement and
resize obey the same bounds and selected ratio. The underlying workspace stays mounted so nested
confirmation dialogs and closing the crop dialog preserve focus and existing work.

The `crop_completed` event represents explicit crop confirmation, not automatic full-image preview.
The historical crop funnel therefore describes the optional-crop path, not all successful creations.

## Verification boundary

Component tests cover async cancellation, replacement/undo persistence and resource invalidation.
Browser tests use real local decoding/generation Workers and mobile viewport/touch simulation.
Neither these tests nor screenshots constitute physical-device or production validation.
