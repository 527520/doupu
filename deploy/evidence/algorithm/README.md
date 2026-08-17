# Human algorithm comparison evidence

The release workflow requires `v<package-version>.json` from a human side-by-side
review of the previous release and the exact candidate parent of the attestation commit.
Automated golden/oracle tests remain mandatory, but do not replace this product-quality review.

```json
{
  "version": "0.2.0",
  "candidateCommit": "full-40-character-candidate-commit-sha",
  "completedAt": "2026-08-17T08:00:00.000Z",
  "tester": "human tester name",
  "passed": true,
  "fixtures": ["photo", "pixel-art", "skin-gradient", "edge-subject", "transparent-antialias", "real-heic"]
}
```

Reject the candidate for lost small subjects, skin-tone banding, haloed transparent
edges, background leakage, incorrect brand codes, or an unexplained regression from
the previous release. Commit only a genuine review of the exact candidate. The tagged
single-parent attestation commit may change only this version's mobile and algorithm
evidence files; both must name its parent as `candidateCommit`. Land that attestation
on the protected `main` branch before tagging it.
