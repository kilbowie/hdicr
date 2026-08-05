# Runbook

## Run it

```bash
pnpm install
pnpm test        # the conformance test — must be green before anything else
pnpm demo        # the whole loop, end to end, ~10 seconds
```

## Run it by hand

```bash
pnpm dev                          # issuer + gate + render, all three
open apps/wallet/index.html       # the REVOKE button
```

## Prove the invariant

The single most important thing in this repository is that it **fails closed**. Prove it, deliberately,
and prove it again after every change to the Gate:

```bash
pnpm dev
# ... issue a mandate, start a render ...

# now kill the issuer
kill $(lsof -ti:3001)

# wait for the freshness window to lapse, then try to render
curl -XPOST localhost:3003/render -H 'content-type: application/json' -d '{"jwt":"…","mandateId":"…"}'
# → refused   (STATUS_UNAVAILABLE)
```

**If that returns a render, stop everything and fix it.** An agent that keeps acting when the kill
switch is unreachable is precisely the failure this project exists to prevent. There is no feature
worth shipping ahead of this.

## The number

`pnpm demo` prints the measured propagation latency.

**Publish whatever it actually is.** A measured 400ms beats a claimed 50ms, every single time, with
every audience that matters. If it is bad, that is a roadmap item — not a reason to round it down.

## Known limits (be honest about these)

| | |
|---|---|
| Receipts are in memory | L3 needs persistence. Say so. |
| Identity is hardcoded `assuranceLevel: 'high'` | Real deployments consume eIDAS 2.0 / UK DVS. Say so. |
| The render is simulated | Frames are a counter. The *gate* is real. Say which is which. |
| No SD-JWT selective disclosure yet | The Mandate is a plain signed JWT. Roadmap. |

Every one of those is obviously a stub. The gate, the propagation, and the receipt are not. **Never
blur that line** — a demo that overstates itself is discovered in the first technical call, and then
nothing you said is trusted.
