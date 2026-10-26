# Frontend startup measurements

Measured on 24 October 2026 against the built local Svelte Worker, using synthetic API state, Node 24.19.0 and Chromium 154.0.8037.57. No provider, production database or Discord requests were made. The before ref is `20c930225c97848cf2f72d0267000bcf853eaaca`; the after source change defers the optional library and game-host room client.

## Results

Desktop (1440px) and mobile (390px) returned the same script totals in each scenario. The feature scope is unchanged: the library opens and renders the festival catalog after its chunk loads, and host/guest game browser tests exercise game creation.

| Scenario | Decoded JavaScript before | After | Change | Per-response gzip before | After | Script requests before / after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| welcome | 202,527 B | 158,973 B | -21.5% | 70,701 B | 60,858 B | 16 / 17 |
| joined-room | 202,527 B | 158,973 B | -21.5% | 70,701 B | 60,858 B | 16 / 17 |
| games | 153,022 B | 141,226 B | -7.7% | 57,268 B | 52,686 B | 14 / 13 |

This measures successful decoded script responses, not wall-clock speed, provider latency, audible playback, Lighthouse, field performance or the full Classic application. Gzip values sum separately recompressed response bodies and do not claim actual wire transfer. Code splitting adds one request to listening-room startup while reducing its payload.

[Machine-readable observations](assets/startup-payload-20261024.json) retain both viewport results.

## Reproduce

Build the candidate and start its local Worker as documented in [the migration guide](SVELTEKIT_MIGRATION.md). Then run:

```sh
PREVIEW_URL=http://127.0.0.1:5174 CHROMIUM_PATH=/usr/bin/chromium npm --prefix apps/web run measure:startup
```

Omit `CHROMIUM_PATH` when using the matching installed Playwright browser. The script refuses non-loopback HTTP origins, mocks all API traffic and never enables provider audio. It verifies that the optional library is absent at startup and actually loads when opened. This structural check runs in browser CI, alongside the existing behavior tests. Different browser/toolchain versions may change byte counts; compare matching scenarios rather than treating the recorded counts as universal.

## Tools and maintenance

- The legacy Miniflare declarations import Zod 3 types directly. A development-only Zod 3 pin preserves strict Worker fixture typing while Knip keeps its own compatible Zod 4 dependency.
- Knip 6.43.0 is pinned as a development dependency. `npm run audit:unused` checks files using declared framework, test and operational entry points. It generates SvelteKit configuration first so clean checkouts work, then runs in full local validation and CI. Review findings before deletion; keep compatibility adapters and manual recovery tools.
- Playwright exercises user journeys and records decoded built-script responses. Its existing browser installation is reused.
- Vite’s production manifest identifies the optional library chunk, so eager-loading regressions fail verification without guessing hashed asset names.
- Existing CodeQL and dependency review remain the security checks. No telemetry service, new paid account or production monitoring SDK was enabled.
