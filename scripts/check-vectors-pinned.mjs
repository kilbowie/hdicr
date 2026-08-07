#!/usr/bin/env node
/**
 * ADR-014 vector pin — the cross-repo half of S1.X1, and the thing that actually closes B4.
 *
 * THIS FILE IS BYTE-IDENTICAL IN THREE REPOSITORIES: h2a-protocol, bridle, hdicr.
 * If you change it in one, change it in all three in the same operation.
 *
 * WHAT PROBLEM THIS SOLVES
 *
 * On 5 August 2026 the estate was measured and found to hold four canonicalisers and two
 * signature encodings. Two of the four were wrong, in DISJOINT ways — the TypeScript hand-roll
 * sorted keys wrongly but serialised correctly; the Python reference sorted correctly but
 * serialised wrongly. Each therefore agreed with RFC 8785, and with the other, on every input
 * anyone had ever tested. They diverged only on a name carrying a diacritic and a lease cap
 * written `500.0`. Every suite was green the entire time.
 *
 * All four implementations now run against the same normative vectors, so that specific defect
 * is caught. But each repository holds its OWN COPY of those vectors, and until this file existed
 * nothing checked that the copies were the same file. That is the identical failure mode one
 * level up: edit bridle's fixture to match a broken bridle canonicaliser and bridle stays green,
 * hdicr stays green, h2a stays green, and the estate is silently back to four canonical forms.
 * A vendored fixture that only its own repository validates is a closed loop wearing the costume
 * of an external check.
 *
 * WHAT THIS ASSERTS
 *
 *   1. The local vectors file hashes to EXPECTED_SHA256.
 *   2. h2a-protocol at UPSTREAM_COMMIT serves a file that hashes to EXPECTED_SHA256.
 *   3. The two are byte-identical.
 *
 * All three are hard failures. In particular an unreachable upstream FAILS — it does not skip.
 * A check that passes when it could not run is worse than no check, because it reports a
 * property it never tested. (It retries first; see fetchUpstream.)
 *
 * WHY A PINNED COMMIT AND NOT A BRANCH
 *
 * Fetching `main` would mean upstream could change the normative canonical form and every
 * downstream repository would silently adopt it on its next CI run — the vectors are normative
 * test data (ADR-014 §4), so that is a spec change arriving without review. Pinning to an
 * immutable commit means changing the canonical form requires editing the pin in all three
 * repositories deliberately, and each of those edits is a reviewed diff.
 *
 * WHY THE PIN LIVES IN THE SCRIPT
 *
 * So that this file differing between repositories is itself the signal. The pin is not
 * configuration; it is the assertion.
 *
 * Usage:  node scripts/check-vectors-pinned.mjs <path-to-local-vectors.json>
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// ─── THE PIN ────────────────────────────────────────────────────────────────────────────────
// Changing the normative canonical form means changing these four lines in h2a-protocol, bridle
// and hdicr, and re-vendoring the fixture in each. That is deliberately not cheap.
const UPSTREAM_REPO = "kilbowie/h2a-protocol";
const UPSTREAM_COMMIT = "17d25c5979bae8230a4ce49c682e79194f880b42";
const UPSTREAM_PATH = "interop/vectors/vectors.json";
const EXPECTED_SHA256 = "6454005ee422073c7d3abf9d0309682cd32358956442fc9ec11e094b5d883436";
// ────────────────────────────────────────────────────────────────────────────────────────────

const RAW_URL = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${UPSTREAM_COMMIT}/${UPSTREAM_PATH}`;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function fail(message, detail) {
  console.error(`\nFAIL: ${message}`);
  if (detail) console.error(detail);
  console.error(
    "\nADR-014 §4 makes interop/vectors/ normative test data. The copies in h2a-protocol, bridle\n" +
      "and hdicr must be the same file; if they are not, each repository is validating its\n" +
      "canonicaliser against its own private idea of the canonical form and the three will\n" +
      "diverge without any suite going red."
  );
  process.exit(1);
}

/** Show where two buffers first differ — a hash mismatch alone does not say what moved. */
function describeDifference(a, b) {
  if (a.length !== b.length) {
    return `  lengths differ: local ${a.length} bytes, upstream ${b.length} bytes`;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      const from = Math.max(0, i - 40);
      return (
        `  first difference at byte ${i}\n` +
        `  local   : ...${JSON.stringify(a.subarray(from, i + 40).toString("utf8"))}\n` +
        `  upstream: ...${JSON.stringify(b.subarray(from, i + 40).toString("utf8"))}`
      );
    }
  }
  return "  buffers compare equal (unreachable)";
}

/**
 * Fetch with a small retry. A transient GitHub blip should not turn into a red build that
 * teaches people to re-run CI until it passes — that habit is how a real failure gets ignored.
 * Exhausting the retries is still a hard failure.
 */
async function fetchUpstream() {
  const attempts = 3;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(RAW_URL, {
        signal: AbortSignal.timeout(20_000),
        headers: { "user-agent": "h2a-vector-pin-check" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastError = err;
      console.error(`  attempt ${attempt}/${attempts} failed: ${err.message}`);
      if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  fail(
    `could not read the pinned vectors from upstream after ${attempts} attempts`,
    `  url  : ${RAW_URL}\n` +
      `  error: ${lastError?.message}\n\n` +
      "  This check does NOT skip when upstream is unreachable. If the pinned commit was\n" +
      "  force-pushed away or the repository moved, fix the pin — do not weaken the check."
  );
}

async function main() {
  const localPath = process.argv[2];
  if (!localPath) {
    console.error("usage: node scripts/check-vectors-pinned.mjs <path-to-local-vectors.json>");
    process.exit(2);
  }

  console.log("ADR-014 vector pin");
  console.log(`  local   : ${localPath}`);
  console.log(`  upstream: ${UPSTREAM_REPO}@${UPSTREAM_COMMIT.slice(0, 12)}:${UPSTREAM_PATH}`);
  console.log(`  pinned  : ${EXPECTED_SHA256}\n`);

  let local;
  try {
    local = readFileSync(localPath);
  } catch (err) {
    fail(`cannot read the local vectors file: ${err.message}`);
  }

  const localSha = sha256(local);
  if (localSha !== EXPECTED_SHA256) {
    fail(
      "the local vectors file does not match the pinned digest",
      `  expected: ${EXPECTED_SHA256}\n` +
        `  actual  : ${localSha}\n\n` +
        "  Someone edited the vectors in this repository. If the canonical form genuinely\n" +
        "  changed, update the fixture AND the pin in all three repositories together."
    );
  }
  console.log(`  local sha256 matches the pin  (${local.length} bytes)`);

  const upstream = await fetchUpstream();
  const upstreamSha = sha256(upstream);
  if (upstreamSha !== EXPECTED_SHA256) {
    fail(
      "upstream at the pinned commit does not match the pinned digest",
      `  expected: ${EXPECTED_SHA256}\n` +
        `  actual  : ${upstreamSha}\n\n` +
        "  A commit SHA is immutable, so this means the pin names the wrong commit."
    );
  }
  console.log(`  upstream sha256 matches the pin  (${upstream.length} bytes)`);

  // Belt and braces: both matched the same digest, so this cannot fail — but SHA-256 equality is
  // an argument about hashes and the property we actually care about is that the BYTES are the
  // same. Assert the thing itself, not a proxy for it.
  if (!local.equals(upstream)) {
    fail("local and upstream vectors differ byte-for-byte", describeDifference(local, upstream));
  }

  console.log("\nPASS: this repository validates against the same normative vectors as the others.");
}

main();
