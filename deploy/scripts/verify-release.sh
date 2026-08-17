#!/bin/sh
# Validate tag provenance and every human-visible version source before publish.
set -eu

VERSION=${1:-${GITHUB_REF_NAME#v}}
echo "${VERSION}" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' \
  || { echo "release tag must be a stable semver" >&2; exit 1; }

PACKAGE_VERSION=$(node -p "require('./package.json').version")
APP_VERSION=$(sed -n "s/^export const APP_VERSION = '\([^']*\)';/\1/p" src/lib/appInfo.ts)
[ "${VERSION}" = "${PACKAGE_VERSION}" ] \
  || { echo "tag/package version mismatch" >&2; exit 1; }
[ "${VERSION}" = "${APP_VERSION}" ] \
  || { echo "tag/app version mismatch" >&2; exit 1; }
grep -Fq "## [${VERSION}]" CHANGELOG.md \
  || { echo "CHANGELOG.md has no section for ${VERSION}" >&2; exit 1; }

# The tagged commit is an evidence-only attestation whose sole parent is the
# exact candidate that humans tested. Binding evidence to HEAD itself would be
# an impossible Git hash self-reference because evidence is part of HEAD's tree.
RELEASE_COMMIT=$(git rev-parse "${GITHUB_SHA:-HEAD}^{commit}")
PARENTS=$(git show -s --format=%P "${RELEASE_COMMIT}")
set -- ${PARENTS}
[ "$#" -eq 1 ] \
  || { echo "attestation commit must have exactly one parent" >&2; exit 1; }
CANDIDATE_COMMIT=$1

MOBILE_EVIDENCE="deploy/evidence/mobile/v${VERSION}.json"
ALGORITHM_EVIDENCE="deploy/evidence/algorithm/v${VERSION}.json"
CHANGED_PATHS=$(git diff-tree --no-commit-id --name-only -r "${RELEASE_COMMIT}" | LC_ALL=C sort)
EXPECTED_PATHS=$(printf '%s\n%s\n' "${ALGORITHM_EVIDENCE}" "${MOBILE_EVIDENCE}" | LC_ALL=C sort)
[ "${CHANGED_PATHS}" = "${EXPECTED_PATHS}" ] \
  || { echo "attestation commit may change only ${MOBILE_EVIDENCE} and ${ALGORITHM_EVIDENCE}" >&2; exit 1; }

# Browser emulation cannot certify touch/viewport/OS integration. A release tag
# is therefore blocked until a human-owned, versioned physical-device matrix is
# committed in the evidence-only attestation. No placeholder or CI-generated
# proof is accepted.
[ -s "${MOBILE_EVIDENCE}" ] \
  || { echo "physical iOS/Android release evidence is missing: ${MOBILE_EVIDENCE}" >&2; exit 1; }
node -e '
  const fs = require("node:fs");
  const evidence = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const [version, candidateCommit] = process.argv.slice(2);
  const valid = evidence.version === version
    && evidence.candidateCommit === candidateCommit
    && typeof evidence.completedAt === "string"
    && !Number.isNaN(Date.parse(evidence.completedAt))
    && typeof evidence.tester === "string" && evidence.tester.trim().length > 0
    && evidence.ios?.browser === "Safari" && evidence.ios?.passed === true
    && evidence.android?.browser === "Chrome" && evidence.android?.passed === true;
  if (!valid) process.exit(1);
' "${MOBILE_EVIDENCE}" "${VERSION}" "${CANDIDATE_COMMIT}" \
  || { echo "physical mobile evidence is invalid or belongs to another candidate commit" >&2; exit 1; }

[ -s "${ALGORITHM_EVIDENCE}" ] \
  || { echo "human old/new algorithm review evidence is missing: ${ALGORITHM_EVIDENCE}" >&2; exit 1; }
node -e '
  const fs = require("node:fs");
  const evidence = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const [version, candidateCommit] = process.argv.slice(2);
  const required = ["photo", "pixel-art", "skin-gradient", "edge-subject", "transparent-antialias", "real-heic"];
  const fixtures = new Set(evidence.fixtures ?? []);
  const valid = evidence.version === version
    && evidence.candidateCommit === candidateCommit
    && evidence.passed === true
    && typeof evidence.completedAt === "string" && !Number.isNaN(Date.parse(evidence.completedAt))
    && typeof evidence.tester === "string" && evidence.tester.trim().length > 0
    && required.every((fixture) => fixtures.has(fixture));
  if (!valid) process.exit(1);
' "${ALGORITHM_EVIDENCE}" "${VERSION}" "${CANDIDATE_COMMIT}" \
  || { echo "algorithm visual evidence is invalid or belongs to another candidate commit" >&2; exit 1; }

if git show-ref --verify --quiet refs/remotes/origin/main; then
  git merge-base --is-ancestor "${RELEASE_COMMIT}" origin/main \
    || { echo "tag commit is not on origin/main" >&2; exit 1; }
fi

LATEST_TAG=$(git tag --list 'v[0-9]*' --sort=-v:refname | grep -Fvx "v${VERSION}" | head -n 1 || true)
if [ -n "${LATEST_TAG}" ]; then
  node -e '
    const current = process.argv[1].split(".").map(Number);
    const latest = process.argv[2].slice(1).split(".").map(Number);
    const newer = current.some((n, i) => n > latest[i] && current.slice(0, i).every((v, j) => v === latest[j]));
    if (!newer) process.exit(1);
  ' "${VERSION}" "${LATEST_TAG}" \
    || { echo "${VERSION} is not newer than ${LATEST_TAG}" >&2; exit 1; }
fi

echo "release provenance verified: v${VERSION}"
