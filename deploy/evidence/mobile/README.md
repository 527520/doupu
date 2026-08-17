# Physical mobile release evidence

The release workflow intentionally rejects a tag until an evidence-only attestation
commit contains `v<package-version>.json` produced after hands-on testing on physical devices.
Playwright emulation is useful regression coverage, but is not accepted as this evidence.

Required shape:

```json
{
  "version": "0.2.0",
  "candidateCommit": "full-40-character-candidate-commit-sha",
  "completedAt": "2026-08-17T08:00:00.000Z",
  "tester": "human tester name",
  "ios": { "device": "iPhone model", "os": "iOS version", "browser": "Safari", "passed": true },
  "android": { "device": "device model", "os": "Android version", "browser": "Chrome", "passed": true }
}
```

First commit the complete release candidate and record its SHA. On both devices test
that exact candidate: upload/crop, parameter regeneration/cancel, touch editing,
PNG/PDF/project export, local save/reload, login and cross-device sync. Then create a
single-parent attestation commit whose only changes are this version's mobile and
algorithm evidence JSON files, both naming the candidate parent SHA. Tag the
attestation commit only after it has landed on the protected `main` branch. Never copy
an older version or CI-generated value.
