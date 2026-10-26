# Optional browser errors and unit coverage

These integrations are source configuration, not proof of an activated account,
working upload, deployed DSN or production event. Keep paid usage and automatic
billing disabled in both providers. A client-side sampler cannot enforce an
account-wide spending limit.

## Sentry: errors only

The native website uses `lib/error-reporting.ts` and the pinned official Sentry
Browser SDK. Core and Worker API processes are not instrumented by this change.
The native root layout calls the shared lazy initializer. With an empty or
malformed DSN, the SDK is not imported and sends no requests.

Set the **public project DSN** only for an explicitly approved build:

| Website | Build variable | Example file |
| --- | --- | --- |
| Native website | `VITE_SENTRY_DSN` | `apps/web/.env.example` |

These are build-time values, not Cloudflare runtime secrets. A DSN is visible in
client code and must never be replaced with a Sentry API/auth token. Use separate
projects/configuration for independent projects and development environments.
Only official HTTPS Sentry ingestion DSNs are accepted by the current validator.
Changing configuration requires a rebuild and separately approved deployment.

The GitHub `Core validation` website job reads the public `VITE_SENTRY_DSN` repository Actions
variable into its build environment. It applies to the sole native website
artifact, not Core. The separate Cloudflare Workers Builds service rebuilds from
source and must receive the same public build variables on its approved trigger;
GitHub variables do not propagate to Cloudflare. Runtime Worker variables cannot
retroactively enable an already compiled client. Missing values keep reporting off.

Only unhandled JavaScript errors/rejections with an application-bundle stack are
eligible. Default integrations are disabled; only global errors and deduplication
are installed. Session recording, Replay, tracing, profiling and console capture
are not enabled. SDK data collection is explicitly off, including users, cookies,
headers, bodies, query parameters, database values, local variables and code
context. Logs, metrics and breadcrumbs are dropped.

An allowlist reconstructs each event and the final transport envelope. It removes
attachments, request details, user/context/extra data, raw messages, function and
module names, full URLs, room/guild identifiers and source context. Only the
generic JavaScript error class, coarse browser bundle category, generated
line/column, random event ID, timestamp and fixed surface label remain. This
deliberately limits diagnostic detail; source-map upload and raw error-message
collection are not implemented. No screenshots or media are attached.

The fetch transport omits credentials and referrers. Direct ingestion still makes
a network request from the browser; provider-side IP retention/filtering must be
reviewed before activation. Do not claim that a browser request conceals its IP.
Error sampling is 10%, with at most five accepted sampled errors per page load
and a bounded transport buffer. The cap runs in the transport after SDK sampling;
sampled-out errors do not consume it. The SDK runs `beforeSend` before sampling,
so that callback only filters private data. This limits bursts but does not
replace provider quotas or zero-overage billing controls.

## Codecov: real, scoped LCOV

`npm run coverage:unit` reruns the existing Node suites with Node's V8 coverage
and LCOV reporter. Node 26, installed locked dependencies and FFmpeg are needed
for the complete command. Reports are generated under ignored `coverage/`:

| Report | Instrumented source filter | Tests |
| --- | --- | --- |
| `shared.lcov` | `lib/**/*.ts` | Existing root `test:unit` list |
| `core.lcov` | `services/core/src/**/*.ts` | Existing Core Node tests |
| `native.lcov` | `apps/web/src/lib/**/*.ts` | Existing native Node tests |

Only loaded files actually instrumented by V8 are reported. This is **not full
repository, UI, Svelte-component or browser coverage**. Modules evaluated through
transpiled/data-URL fixtures cannot be reliably attributed to their original
TypeScript files and are not claimed as covered. Core's audio checks require real
FFmpeg, but do not establish audible live Discord behavior. Report generation
fails if a suite fails or produces no instrumented source records.

Coverage is an explicit `coverage_only=true` dispatch of the normal `core.yml`
workflow. It runs the instrumented suites instead of the normal validation jobs;
PRs and main pushes do not start another automatic coverage pass. GitHub OIDC
`id-token: write` is scoped to that job. The official Codecov Action is pinned to
an immutable SHA; there is no long-lived upload token and no PR OIDC grant.

Reports are generated and validated with uploads disabled by default. To request
one upload containing all three LCOV files, set `upload_coverage=true` and the
repository variable `CODECOV_ENABLED=true`. Automatic file discovery and uploader
telemetry stay disabled. Missing reports and test/upload failures fail the job.
Manual runs never publish release artifacts. Their regular-job check names are
prefixed with `manual /`, so report-only runs cannot replace required PR checks.

After the workflow is merged, a report-only run can be started with:

```bash
gh workflow run core.yml --ref main -f coverage_only=true -f upload_coverage=false
```

There are no automatic per-PR or per-merge coverage uploads. Badges and PR
comparisons reflect only explicitly uploaded reports; a PR comparison requires
reports for both its base and head. Required application validation remains
independent of these optional reports.

The free account's private-repository upload allowance is shared across projects.
Manual uploads avoid automatic churn but cannot enforce a global monthly allowance.
Review the account's actual usage before requesting reruns, and set
`CODECOV_ENABLED=false` if the allowance is nearly exhausted. Keep required
application validation active. Reports for intermediate draft commits will be
absent; PR comparison needs both the base and reviewed head reports.

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
