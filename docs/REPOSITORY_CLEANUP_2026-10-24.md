# Repository cleanup, 24 October 2026

The owner requested removal of old unnecessary GitHub branches and files. This record describes completed ref cleanup and the source changes proposed with the v3 review candidate.

## Branches

Removed 58 remote branch refs. Each exact tip was verified as an ancestor of canonical `main` at `6e8b82194a755ffecaf8c8f43f849542b26b8d7e`, with no commits outside main and no open pull request using that head. GitHub deletion used an atomic push with an explicit expected SHA lease for every ref. A verified local Git bundle was created before deletion. Source history remains reachable through main; no history was rewritten.

35 branch refs remained immediately after cleanup. Main, beta, dev, nightly, open PR heads and all archived/Rust/experimental branches were preserved. Squash-merged status alone was not accepted as ancestry evidence.

| Removed branch | Preserved tip | Related merged PRs |
| --- | --- | --- |
| `agentic-autofix/fix-code-scanning-alerts` | `72a7b173f43249a456c3399b9314e5241d63f219` | #107 |
| `chore/codex-usage-efficiency-20261022` | `28959a5371d7001f2ae16e43109e999adff0e29e` | #121 |
| `chore/remove-legacy-dashboard` | `7540cf870f76c9008db19f0026d6291d1045421d` | #72 |
| `chore/typescript-cleanup-readme` | `fdab833347434d2c273ffb7c187081fb52b0758a` | #71 |
| `codex/admin-seek-resume-audit-20261016` | `fd7b099ea0a9263a6d174d728218b54712d0348e` | #38 |
| `codex/cloudflare-migration` | `867132d2c83e314a1f8d05530877e0224738569b` | #115 |
| `codex/concert-undo-capacity-20261017` | `d9b6521b60652721fb1012ef354d8254ef3ce08c` | #49 |
| `codex/deezer-connection-readiness` | `b1d02e5f07aaff3680c5279d78abfe38384cefca` | #110 |
| `codex/dependency-review-security` | `c727e89fe9e79504e2baba5497b04defe1081bb8` | #106 |
| `codex/docker-image-identity` | `d2e1274b129ba5c6a5ee4333f0456551f3d68e96` | #99 |
| `codex/festival-playlists` | `59994dbddb8927a99a0e7e61e64ace94515039f8` | #112 |
| `codex/github-project-workflows` | `d6db386417a53034e58064650d819066cf9ce41b` | #100 |
| `codex/github-tested-builds` | `a5b6cfcf6a0f43bfb0622bb250af4ded07646d0f` | #98 |
| `codex/guess-catalog-capacity` | `189a17300d418bacd2bdbfa251496e6e646cbe13` | #95 |
| `codex/guess-readiness` | `9d68255688930ef4b6be7394aee7f850845916b3` | #94 |
| `codex/integrated-update-channels-20261023` | `55c62e28a73381ba1902f2090802028d7dbb0623` | #126 |
| `codex/owner-update-link-20261018` | `fd8d5ee59735a8553e0c4d218839392e54806d7b` | #69 |
| `codex/playback-radio-ux` | `345ce2d4d44e05f50a6cd8df314e931fd5aa275c` | #96 |
| `codex/premium-ui-review` | `5c547291c03d274f8322f8601d097f235a9b31d4` | #113 |
| `codex/project-review-rules` | `fb1e6bebee92574e3854a057be3f0ce334305b84` | #108 |
| `codex/security-transitive-dependencies` | `147ce3abfffc5ace8ce700fdc6f731e29758cb37` | #109 |
| `codex/sites-hosting-transition` | `28ebb864ec1cab98f689a012e6a8ef5b1e9553a3` | #119 |
| `codex/stability-2026-10-16` | `67a8c6be99ab521907b138863f18ce32c4e29227` | #33 |
| `codex/stage-discord-polish-20261017` | `9d4254d98a5c4cd0c9ba678a28bd62824781f600` | #48 |
| `codex/typescript-sync-optimisation-20261017` | `c0e0af6d0fc218199a42883ab1051c68a67169db` | #46 |
| `codex/v3-readiness` | `706bc3a56edd498c236c636f4671217729795125` | Ancestry verified |
| `codex/visible-room-queue` | `c319ec15b5881666e3a570161e29725e7c1dceb5` | #97 |
| `codex/youtube-guess-audio` | `3dfa3a46c3b6864c776aa64c66e0567166a6556b` | #111 |
| `docs/ai-delegation-release-rules-20261017` | `eb9530197817a1372069a257dacac573a10f2580` | #54 |
| `docs/approved-toolchain-20261022` | `705d596ea72599406edf70996100aabdc6748dc9` | #118 |
| `docs/chat-codex-workflow-dot-paused-20261020` | `f8428e2396fe6057fc787cede47ff5556dd54491` | #89 |
| `docs/dot-codex-autonomy-20261020` | `ec61b8eb4b8e11ddaf4399d3fa484a3d446660b8` | #82 |
| `docs/dot-coordinator-workflow-20261016` | `a8cf761484b425f2a08254af7a78a8df4078f6f3` | #35 |
| `docs/main-dev-branch-strategy-20261016` | `592fe1089d3cf8e22501ccb6948df9363acc28ae` | #43 |
| `docs/public-patch-notes-and-tech-choices-20261022` | `9335d687af7bd94c651dd1cd8b98f3d2530fceb2` | #116 |
| `docs/streamline-ai-instructions-bokmal-20261020` | `b9064a6d371744ca9f597201f1f5ffeebba56ef5` | #86 |
| `docs/streamline-dot-codex-guidance-20261020` | `bc9b823915f9ceb0b4ce1cb341ea2d34c2f08a3d` | Ancestry verified |
| `feat/afterparty-3-svelte-player` | `dc8402e6a5aa8238a7e6b1da105dc1e64be8884e` | #122 |
| `feature/guess-synthetic-test` | `497e5c639ca80030659ee47799833cd00177a010` | #88 |
| `feature/radio-v2-20261017` | `0d49644d6ce5292dc658f78aeca13fa94ceb287e` | #60 |
| `feature/v3-concert-extras` | `e5f5150fd847e5824473c268b2e55a278631488a` | Ancestry verified |
| `fix/append-queue-order` | `1cfecd3e79f612d0eac69196c42957e0efabbc9c` | #83 |
| `fix/browser-storage-freshness-20261018` | `5ad12d9bb6379ecd0754729a9395ea2fa5475f19` | #62 |
| `fix/dj-logo-position` | `c8dff43f2b700b28b8cdd924bcbddd4cda6ac5dd` | #73 |
| `fix/guess-media-worker` | `79def54f88ea62878a7881b232c0bb8f73905592` | Ancestry verified |
| `fix/issue-audit-20261017` | `378bfa12b9e1d9069a5823bbdb45873126837d5e` | #56 |
| `fix/manual-radio-capacity-20261018` | `d791357ade1b27ef53f8607992121203d81be97f` | #63 |
| `fix/radio-genre-fallback-37` | `1c249e8a8256d1f706c7830d1882cf1fdf7216e6` | #42 |
| `fix/radio-prefer-music-video` | `0803bc706530b360677f0936fd1be4921f5c8534` | #74 |
| `fix/radio-real-catalog-20261018` | `469d99680adabcffe2451a7071f915802eb762e8` | #64 |
| `fix/radio-review-venues-aliases` | `5be83a8459e6e67c906e7957e49600500230a33a` | #65 |
| `fix/room-undo-exclusions-20261017` | `59a34c7708840e22c20f1b6a9a8c4ad88260cc5c` | #55 |
| `fix/settings-radio-recovery-20261017` | `d72a86a51ee2c728383ceb1a5d605abf59033508` | #52 |
| `fix/stable-player-errors-boundary` | `78b7a2105fc18f66efab9b511a44781627ec34fd` | #84 |
| `fix/unified-ui-admin-settings-20261018` | `81b148e0740fce74364f16ccccd327379b993d86` | #68 |
| `perf/runtime-optimization-20261017` | `eebfd09d8c8f4f7155fbf7c754d0711303826f1a` | #59 |
| `perf/typescript-radio-ui-system-20261018` | `bb086ed16a6b8fe49c013afec51bb16f7fa03a9d` | #67 |
| `review/daily-stability-20261019` | `e79eacd56ba3561b794f1f161475a1aec7ec3c5b` | #70 |

## Files and tools

Knip 6.43.0 initially reported manual test tools, Worker entry points, Core migration tools and installer compatibility shims as unused. The checked-in configuration declares those actual framework/operational entry points. The configured file audit identified only `db/index.ts`: its `getDb` wrapper has no repository consumers, while request handlers use the existing `lib/server.ts` DB access. The unused wrapper is removed in this PR. Drizzle schema and migration files remain.

Installer `.mjs` compatibility entry points, Core data import tools, Classic rollback source, license notices, archived benchmarks and referenced visual evidence are retained. A static unused-code report is not proof that an operational entry point is unnecessary.

Run `npm run audit:unused` for the pinned file audit. Playwright and the built-Worker startup measurement cover behavior and optional-feature loading; they do not establish live provider or Discord audio quality.

## Recovery

The local ignored `.local/merged-branches-20261024.bundle` was verified before ref deletion. `git bundle list-heads` lists its original remote refs. Every deleted tip is also an ancestor of the main commit above, so a branch can be recreated from its recorded SHA if necessary. No recovery archive, credentials, local database or host configuration is uploaded.
