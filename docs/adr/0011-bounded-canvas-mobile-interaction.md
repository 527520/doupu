# ADR-0011: Bounded canvas and explicit mobile interaction modes

- Status: accepted
- Date: 2026-08-30
- Refines: CONTEXT.md D5, D8 and D39

## Context

Patterns may contain up to 200×200 cells. Rendering the whole pattern as a canvas whose CSS and
backing dimensions grow with the pattern makes desktop pages expand horizontally and mobile pages
expand vertically. CSS-only shrinking also separates the displayed size from the coordinate system,
so a visible cell may not be the cell that receives an edit.

Touch input has a second ambiguity: a finger moving across the canvas may mean “navigate” rather
than “change data”. In particular, committing a follow-along mark on `pointerdown` changes progress
before the browser can classify the gesture as a scroll. Editing has the same conflict when one
finger is expected to draw and scroll at the same time. Navigation must therefore be a read-only
operation with an explicit interaction mode, not an incidental side effect of a data-changing tool.

## Decision

- Editing and follow-along share a bounded grid camera described by scale, origin and viewport size.
  Screen-to-cell conversion and visible-cell calculation use that camera as their single coordinate
  source. The canvas matches the viewport and renders only visible cells; its backing buffer is
  bounded by viewport size and device pixel ratio rather than total pattern dimensions.
- Mobile editing and follow-along use a `100dvh` immersive workspace with fixed controls and safe-
  area padding. Mobile editing opens in an explicit hand/navigation mode; drawing, erasing, filling
  and picking require selecting their respective tools. Desktop uses the same bounded camera in the
  normal workbench layout and is not immersive.
- One-finger pan, two-finger pan/zoom, wheel zoom and other camera navigation never edit a cell or
  follow-along progress. Adding a second pointer cancels any uncommitted data gesture. Pointer
  cancellation, tool changes and navigation-mode changes likewise commit no data.
- Mobile follow-along opens in hand mode. Mark mode commits a cell only on `pointerup` when exactly
  one pointer participated and movement stayed within the 8 CSS-pixel tap threshold. Crossing the
  threshold turns the gesture into navigation without first changing progress. Desktop may open in
  mark mode, but follows the same `pointerup` commit rule.
- Follow-along work is partitioned into 29×29 boards from left to right, then top to bottom. Row
  completion changes only the current local row within the current board; edge boards use their
  actual smaller bounds. Only stitchable cells count; transparent, external and colourless cells
  are not stitchable.
- A 7×7 finger loupe is a read-only view of the targeted cell and its neighbours. It may accompany
  an editing or marking gesture, but it is hidden during pan or multi-pointer zoom and cannot itself
  commit data.
- `StitchProgress` remains version 1 and remains local to IndexedDB; it is not added to project files
  or cloud synchronization. Camera position, active interaction mode, loupe state and undo history
  are session state only. Follow-along history is capped at 100 entries and is not persisted.

## Alternatives considered

- **Keep a pattern-sized canvas and visually constrain it with CSS.** Rejected because large patterns
  still control page geometry, backing-buffer cost remains tied to total pattern size, and visual
  scaling can make pointer hit-testing inaccurate.
- **Let one-finger movement always edit or mark and reserve navigation for two fingers.** Rejected
  because it makes ordinary one-handed scrolling destructive and is difficult to discover on a
  phone.
- **Infer scrolling after committing on `pointerdown` and then undo the change.** Rejected because
  observers and persistence may see a mutation that the user never intended, and cancellation is
  harder to make atomic than delaying the commit until `pointerup`.
- **Persist camera, mode and undo history with the pattern or progress.** Rejected because they are
  transient workspace concerns, would complicate project and synchronization formats, and offer no
  durable user value.

## Consequences

- Large patterns no longer stretch the document or require a pattern-sized backing canvas. Camera
  movement and zoom must invalidate and redraw the visible region.
- Every grid interaction must pass through the shared coordinate conversion and gesture state
  machine. Tests must cover zoomed and panned hit-testing as well as tap, drag, second-pointer and
  `pointercancel` sequences.
- Mobile users can navigate safely with one hand, at the cost of an explicit mode switch before
  drawing or marking. Persistent mode controls and cursor/loupe feedback must make the current mode
  visible.
- Row progress now has a board-local meaning. Overall percentages and persisted done bits retain
  their existing semantics, so no `StitchProgress`, project-file, API or database migration is
  required.
- Leaving and re-entering a workspace resets camera, mode and undo history. Existing progress is
  used to locate the first incomplete board and row, but does not restore prior view state.
