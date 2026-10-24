# Optional browser errors and unit coverage

These integrations are source configuration, not proof of an activated account,
working upload, deployed DSN or production event. Keep paid usage and automatic
billing disabled in both providers. A client-side sampler cannot enforce an
account-wide spending limit.

## Sentry: errors only

Classic and v3 share `lib/error-reporting.ts`, using the pinned official Sentry
Browser SDK. Core and Worker API processes are not instrumented by this change.
The two browser entry points call the same lazy initializer. With an empty or
malformed DSN, the SDK is not imported and sends no requests.

Set the **public project DSN** only for an explicitly approved build:

| Website | Build variable | Example file |
| --- | --- | --- |
| Classic | `NEXT_PUBLIC_SENTRY_DSN` | Root `.env.example` |
| v3 | `VITE_SENTRY_DSN` | `apps/web/.env.example` |

These are build-time values, not Cloudflare runtime secrets. A DSN is visible in
client code and must never be replaced with a Sentry API/auth token. Use separate
projects/configuration for independent projects and development environments.
Only official HTTPS Sentry ingestion DSNs are accepted by the current validator.
Changing configuration requires a rebuild and separately approved deployment.

Only unhandled JavaScript errors/rejections with an application-bundle stack are
eligible. Default integrations are disabled; only global errors and deduplication
are installed. Session recording, Replay, tracing, profiling and console capture
are not enabled. SDK data collection is explicitly off, including users, cookies,
headers, bodies, query parameters, database values, local variables and code
context. Logs, metrics and breadcrumbs are dropped.

An allowlist reconstructs each event and the final transport envelope. It removes
attachments, request details, user/context/extra data, raw messages, function and
module names, full URLs, room/guild identifiers and source context. Only the
generic JavaScript error class, coarse Classic/v3 bundle category, generated
line/column, random event ID, timestamp and fixed surface label remain. This
deliberately limits diagnostic detail; source-map upload and raw error-message
collection are not implemented. No screenshots or media are attached.

The fetch transport omits credentials and referrers. Direct ingestion still makes
a network request from the browser; provider-side IP retention/filtering must be
reviewed before activation. Do not claim that a browser request conceals its IP.
Error sampling is 10%, with at most five accepted sampled errors per page load
and a bounded transport buffer. This limits bursts but does not replace provider
quotas or zero-overage billing controls.

## Codecov: real, scoped LCOV

`npm run coverage:unit` reruns the existing Node suites with Node's V8 coverage
and LCOV reporter. Node 26, installed locked dependencies and FFmpeg are needed
for the complete command. Reports are generated under ignored `coverage/`:

| Report | Instrumented source filter | Tests |
| --- | --- | --- |
| `classic.lcov` | `lib/**/*.ts` | Existing root `test:unit` list |
| `core.lcov` | `services/core/src/**/*.ts` | Existing Core Node tests |
| `v3.lcov` | `apps/web/src/lib/**/*.ts` | Existing v3 Node tests |

Only loaded files actually instrumented by V8 are reported. This is **not full
repository, UI, Svelte-component or browser coverage**. Modules evaluated through
transpiled/data-URL fixtures cannot be reliably attributed to their original
TypeScript files and are not claimed as covered. Core's audio checks require real
FFmpeg, but do not establish audible live Discord behavior. Report generation
fails if a suite fails or produces no instrumented source records.

The separate Unit coverage workflow is gated by repository variable
`CODECOV_ENABLED=true`, after linking the repository to the free account. It
grants `id-token: write` only to the coverage job and authenticates the official,
immutable-SHA-pinned Codecov Action with GitHub OIDC. There is no long-lived
upload token. Fork and Dependabot PRs skip this optional job and receive no OIDC
grant. The normal validation workflow still runs independently.

Exactly one upload includes all three LCOV files per eligible workflow run.
`codecov.yml` defines separate path components without extra uploads. Automatic
file discovery and Codecov uploader telemetry are disabled. Upload failures fail
the job when enabled; no missing-report or failed-test result is concealed. No
upload is attempted while the variable is absent/false.

## Validate before activation

Run the privacy regression tests, lint, types, unused-file audit, ordinary full
validation and coverage generation. In an isolated browser, verify no Sentry
network traffic without a DSN and inspect an explicitly approved synthetic error
through the sanitized transport before enabling a real DSN. Confirm zero-overage
account settings and actual Codecov OIDC/report acceptance separately. Never use
live Discord, private rooms or real user data as a test event.

References: [Sentry v11 migration and data collection](https://github.com/getsentry/sentry-javascript/blob/develop/MIGRATION.md),
[Codecov Action OIDC](https://github.com/codecov/codecov-action#using-oidc),
[Codecov components](https://docs.codecov.com/docs/components).
