# Cloudflare Free operation

The native website keeps existing static assets ahead of the Worker with
`assets.run_worker_first: false`. The packaging step writes this explicitly and
configuration verification rejects a Worker-first artifact. Static files must
remain public assets only. API responses, sessions, private rooms and live
playback responses are not shared-cache candidates.

Cloudflare currently documents 100,000 Worker requests per day per Free account
and 10 ms CPU time per invocation. Static asset requests are free and unlimited;
waiting for network operations does not consume CPU time. These are separate
limits: reducing polling does not establish that SSR or API CPU fits 10 ms.

Sources:

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/

## Room request budget

Without a healthy live connection, browser rooms retain their existing
one-second authenticated polling fallback. While a calibrated SSE connection
has an unexpired playback lease, redundant reads are skipped until the last
authenticated snapshot is five seconds old. This cuts those steady-state
snapshot reads from approximately 60 to 12 per minute. SSE connections, clock
samples, commands and other pages consume additional requests. These are
request-rate calculations, not measured production traffic or a capacity SLA.

The one-second local timer still checks stream health. Stream errors, expired
leases and failed calibration restore the existing polling cadence. Mutations
still return their authoritative snapshot immediately. Server authorization,
revision checks, playback leases and clock sampling remain unchanged.
Authenticated role and presence updates can now appear up to four seconds later
when the live connection is healthy; server command authorization remains the
authority throughout. Do not lengthen playback leases to reduce requests.

## Release verification

Build and test the exact reviewed commit using the normal repository checks.
Use the existing website-only Cloudflare release workflow and matching source
provenance. Preserve DB bindings, secrets, domains and migrations. Do not deploy
current `main` over a different production generation merely to apply this
optimization. Compare the live website receipt first, review intervening source
changes and complete the native website acceptance checks before publication.

After an approved release, verify static files bypass Worker invocation in
Cloudflare metrics, inspect actual request and CPU percentiles, and test two
browsers with steady SSE, a dropped stream, clock failure, reconnection, host
revocation and stale commands. Confirm synchronization and audible playback on
real devices. Isolated regression tests do not prove these live properties.
