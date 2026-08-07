#!/usr/bin/env bash
#
# THE FAILING-ACCESS TEST (S1.H2, executed at G9)
#
# The central claim of this programme is that revocation and issuance are exercised by the issuer,
# and that the operator (Truly Imagined) and the verifier (Bridle) CANNOT exercise them. Today that
# claim rests on an absence: Bridle has no revoke route, TI has no signing key. An absence is not a
# control — it is a description of the current code, and code changes.
#
# This test converts it into a policy statement by trying to sign with the H2A issuer key from TI's
# and Bridle's real principals and requiring AccessDenied. Its redacted output becomes
# docs/h2a/AUTHORITY-SPLIT-PROOF.md (S2.H4).
#
# WHAT MAKES IT MEANINGFUL, and the way it could quietly become meaningless:
#
#   A test that passes because the credentials were wrong, the key id was mistyped, or the role
#   could not be assumed proves nothing at all — every one of those also produces a failure, and a
#   naive script reads any failure as success. So each case here asserts THREE things:
#     1. the role assumption SUCCEEDED (we really are that principal), and
#     2. the sign attempt FAILED, and
#     3. it failed with AccessDenied specifically — not ValidationException, not NotFoundException,
#        not ExpiredToken.
#   Anything else is reported as INCONCLUSIVE rather than PASS. An inconclusive authority proof is
#   the one outcome worse than a failing one, because it reads as green.
#
# NOT RUN AUTOMATICALLY. It needs real role assumption against production AWS and is gated on G9.
#
# Usage:
#   ./scripts/authority-split-test.sh <ti-role-arn> <bridle-role-arn> [environment]
#
set -uo pipefail

ENVIRONMENT="${3:-production}"
STACK="${STACK_NAME:-hdicr-${ENVIRONMENT}}"
TI_ROLE="${1:-}"
BRIDLE_ROLE="${2:-}"

if [ -z "$TI_ROLE" ] || [ -z "$BRIDLE_ROLE" ]; then
  echo "usage: $0 <ti-role-arn> <bridle-role-arn> [environment]" >&2
  exit 2
fi

echo "H2A AUTHORITY SPLIT — failing-access test"
echo "  environment : $ENVIRONMENT"
echo "  date        : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

# Resolve the key from the stack rather than accepting it as an argument: a proof that depends on
# someone pasting the right ARN is a proof about that person's care.
KEY_ARN=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='H2aIssuerKeyArn'].OutputValue" --output text 2>/dev/null)
ISSUER_ROLE=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='H2aIssuerSigningRoleArn'].OutputValue" --output text 2>/dev/null)

if [ -z "$KEY_ARN" ] || [ "$KEY_ARN" = "None" ]; then
  echo "INCONCLUSIVE: could not read H2aIssuerKeyArn from stack $STACK." >&2
  echo "              Without the key this test would 'pass' by failing for the wrong reason." >&2
  exit 3
fi

echo "  key         : ${KEY_ARN%%/*}/…redacted…"
echo "  issuer role : $ISSUER_ROLE"
echo

DIGEST=$(printf 'authority-split-probe' | openssl dgst -sha256 -binary | base64)
overall=0

# Try to sign as $1 (a role ARN). Expects AccessDenied.
attempt_sign_as() {
  local label="$1" role_arn="$2"
  echo "── $label"
  echo "   principal: $role_arn"

  local creds
  creds=$(aws sts assume-role --role-arn "$role_arn" \
            --role-session-name h2a-authority-split-probe \
            --duration-seconds 900 --output json 2>&1)
  if [ $? -ne 0 ]; then
    # Could not become this principal, so nothing was tested. NOT a pass.
    echo "   RESULT: INCONCLUSIVE — could not assume the role, so no sign attempt was made."
    echo "           ${creds%%$'\n'*}"
    overall=1
    return
  fi
  echo "   assumed the role successfully (so the sign attempt below is a real test)"

  local out rc
  out=$(AWS_ACCESS_KEY_ID=$(echo "$creds" | jq -r .Credentials.AccessKeyId) \
        AWS_SECRET_ACCESS_KEY=$(echo "$creds" | jq -r .Credentials.SecretAccessKey) \
        AWS_SESSION_TOKEN=$(echo "$creds" | jq -r .Credentials.SessionToken) \
        aws kms sign --key-id "$KEY_ARN" \
          --message "$DIGEST" --message-type DIGEST \
          --signing-algorithm ECDSA_SHA_256 2>&1)
  rc=$?

  if [ $rc -eq 0 ]; then
    echo "   RESULT: *** FAIL *** this principal SIGNED with the issuer key."
    echo "           The authority split does not hold. Do not publish the proof."
    overall=1
    return
  fi

  if echo "$out" | grep -qiE "AccessDenied|not authorized|explicit deny"; then
    echo "   RESULT: PASS — AccessDenied, as required."
    echo "           $(echo "$out" | grep -oiE 'An error occurred \([A-Za-z]+\)' | head -1)"
  else
    # Failed, but for some other reason — which tests nothing about authority.
    echo "   RESULT: INCONCLUSIVE — the call failed, but not with AccessDenied."
    echo "           $(echo "$out" | head -1)"
    overall=1
  fi
}

attempt_sign_as "Truly Imagined (the OPERATOR — must not be able to issue or revoke)" "$TI_ROLE"
echo
attempt_sign_as "Bridle (the VERIFIER — fetch-and-verify only, ADR-009)" "$BRIDLE_ROLE"
echo

if [ $overall -eq 0 ]; then
  echo "AUTHORITY SPLIT HOLDS: neither the operator nor the verifier can sign with the issuer key."
  echo "Capture this output, redact the account id, and commit it as docs/h2a/AUTHORITY-SPLIT-PROOF.md"
else
  echo "NOT PROVEN. Do not publish AUTHORITY-SPLIT-PROOF.md from this run."
fi
exit $overall
