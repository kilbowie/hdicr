# Vendored fixtures

`h2a-vectors.json` is a verbatim copy of `interop/vectors/vectors.json` from
[h2a-protocol](https://github.com/kilbowie/h2a-protocol), the **normative** ADR-014 test data.

Do not edit it here — and since S1.X1 that is enforced rather than requested. CI runs
`scripts/check-vectors-pinned.mjs` against this file **before** `pnpm test`, asserting it is
byte-identical to h2a-protocol at a pinned commit. An unreachable upstream fails the build; it does
not skip.

The ordering is the point. `test/adr014-vectors.test.ts` proves this service's canonicaliser
reproduces the vectors — but if the fixture were wrong, that test would compare hdicr against a file
hdicr controls and pass. Proving the fixture is what makes the test evidence about the estate rather
than about itself.

This matters more here than anywhere else in the estate: when it was measured on 5 August 2026,
hdicr was the **only** conformant implementation on both canonicalisation and signature encoding,
and every other component was ported onto what it already did. "hdicr is the correct one" was an
assumption the whole port rested on.

Refreshing the vectors is a three-repository operation, described in
[interop/README.md](https://github.com/kilbowie/h2a-protocol/blob/main/interop/README.md#the-pin):

```sh
cp ../h2a-protocol/interop/vectors/vectors.json services/credentials-service/test/fixtures/h2a-vectors.json
node scripts/check-vectors-pinned.mjs services/credentials-service/test/fixtures/h2a-vectors.json
```

The private key inside is a **published test key**, committed on purpose so every implementation
verifies identical bytes. It must never appear in a deployed configuration.

`../../../../.gitattributes` marks this directory `-text`. That is not housekeeping: without it a
Windows checkout rewrote 124 line endings and the fixture became 9497 bytes instead of 9373, so
"byte-identical across three repositories" was false on Windows while Linux CI stayed green.
