# ADR-0009: Revision-CAS local-first synchronization

- Status: accepted
- Date: 2026-08-17
- Supersedes: the last-write-wins synchronization choice in ADR-0002

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
- Original photos never enter the synchronization record or the server.

## Consequences

- Conflicts become explicit and recoverable instead of depending on unsynchronized wall clocks.
- API, database adapters, IndexedDB adapters and fakes must implement the same revision contract.
- A local-save indicator and a cloud-sync indicator are separate states; “saved locally” does not
  imply “synced to cloud”.
- Clients created before this protocol must migrate imported v1 data once and then write only the
  current project/API format; there is no dual-write compatibility path.
