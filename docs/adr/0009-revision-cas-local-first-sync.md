# ADR-0009: Revision-CAS local-first synchronization

- Status: accepted
- Date: 2026-08-17
- Supersedes: the last-write-wins synchronization choice in ADR-0002
- Superseded in part by: ADR-0012's strict ProjectFile v3 decision

## Context

Designs and custom palettes are editable offline and on more than one device. Comparing
client-supplied `updatedAt` timestamps silently overwrites data when device clocks differ or two
devices edit the same server version concurrently. The original must remain recoverable whenever
the system cannot prove that an update is based on the latest server state.

## Decision

- Every synchronized design and custom palette has a server-owned, monotonically increasing
  integer `revision`.
- A client update carries `baseRevision`. The Route Handler checks and increments it in the same
  database transaction as the write. A stale base returns HTTP 409 and the current cloud record.
- Saving is local-first. A successful local write records a durable pending-sync marker; verified
  accounts then synchronize in the background. Network failure must not turn a successful local
  save into a failed save, and the marker is cleared only after synchronization succeeds.
- On 409, the cloud original is preserved. The divergent local version becomes a clearly labelled
  local conflict copy so the user can compare or recover both versions; the client never retries it
  as an unconditional overwrite.
- Collection reads use 50-item cursor pages. Deletions keep only synchronization metadata in a
  tombstone and are hard-deleted after 90 days.
- Original photos and bounded local generation sources never enter the synchronization record or
  the server. The latter lives in a separate IndexedDB store keyed by design ID.
- Synchronization preserves a source only when the design content is unchanged. A different remote
  design replacing the original ID clears that ID's source; conflict handling writes the divergent
  design and its source to the copy before replacing or deleting the original ID.

## Consequences

- Conflicts become explicit and recoverable instead of depending on unsynchronized wall clocks.
- API, database adapters, IndexedDB adapters and fakes must implement the same revision contract.
- Every individual source write or clear is atomic with its design record. Conflict reconciliation
  is serialized by the origin-wide design lock and copies before clearing; an interruption may
  leave a recoverable duplicate, but never binds the old source to newly pulled pattern content.
- A local-save indicator and a cloud-sync indicator are separate states; “saved locally” does not
  imply “synced to cloud”.
- ADR-0012 supersedes this decision's former one-time v1 import migration. The application accepts
  only strict ProjectFile v3 and does not migrate v1/v2 data, dual-write old formats, or clear old
  test data automatically; test-data cleanup remains an explicit release operation outside the app.
