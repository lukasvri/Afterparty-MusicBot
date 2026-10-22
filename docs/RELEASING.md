# Versioning and release notes

Afterparty uses one product version for the website and Core. The current version
is recorded in both package manifests and `lib/releases.json`. Package versions
omit the `v` prefix; Git tags and GitHub Releases include it, for example package
`2.1.1` and tag `v2.1.1`. Semantic versioning began at `v1.0.0`. The old integer
labels are historical identifiers, not semantic major versions. Never rename or
renumber those entries or move existing tags.

## Choose the next version

- Bug fix: increment PATCH by one, for example `1.4.9` to `1.4.10`.
- Larger update: increment MINOR by one and reset PATCH to zero, for example
  `1.4.9` to `1.5.0`.
- Massive update: increment MAJOR by one and reset MINOR and PATCH to zero,
  for example `1.4.9` to `2.0.0`. Breaking compatibility requires a major release.

Numbered `alpha.N`, `beta.N` and `rc.N` prereleases identify unfinished previews.
Start at `alpha.1` on the next semantic version and advance the number or stage
without advertising a stable release. A preview build is not deployment evidence.

When an unfinished preview line is superseded by the next minor or major line,
start that higher line at `alpha.1` and preserve the earlier preview notes.
This does not create a stable release for the abandoned line or skip directly to
beta or rc. Unmerged competing proposals are review material, not historical
releases: reconcile their scope and versions in the combined PR. Keep the
independent Activity beta source separate from ordinary bot/web candidates.

For a release containing several changes, use the largest applicable increment.
Continue from the current shared version; do not reinterpret historical V36 as `36.0.0`.
The tested `nextVersion` helper in `scripts/releases.ts` encodes these rules.

An unfinished feature preview may use a numbered prerelease, for example
`3.0.0-alpha.1`, in both manifests, locks and canonical notes. The first preview
must target the next patch, minor or major version of the preceding stable entry,
or follow the higher-line alpha supersession rule above when that source line
is still a prerelease.
Increment the same stage one number at a time; a following beta or rc stage starts
at 1. Promotion to that stable version is a separate release decision. Prerelease
notes must identify preview limitations and must not claim stable availability or
deployment. Preserve intervening stable patch histories when reconciling parallel
PRs; do not merge unrelated feature branches merely to reserve a version.

Do not reuse a prerelease label already present in another maintained branch for
new source. The integrated bot/web preparation uses the distinct `2.4.0-alpha`
line while `beta` retains its experimental v3 history. The separate unmerged
v3 rc proposals remain review material; neither their labels nor a preparation
alpha establish v3 acceptance. A later v3 proposal must reconcile all candidates
and the owner-approved release scope without promoting Activity experiments.

## Notes for every change

Every code or user-facing change must carry written release/patch notes in the
same PR. Write them during implementation and update them when the scope changes,
including after review fixes. Describe actual behavior, affected users and any
compatibility or operator action; distinguish verified results from limitations.

**Two audiences, one truthful history:** GitHub records *all* real changes,
including internal fixes, dependency/security work, CI, infrastructure and
user-visible improvements. The website's `/patch-notes` shows *only* concise,
verified, user-relevant changes actually included in the displayed build.
A development branch, open PR, green CI or GitHub Release is not evidence that
any change is deployed. Never write future promises as completed functionality.
If a change is available only in an alpha preview, label that scope accurately.

- Product code changes, including internal fixes, use `lib/releases.json` for
  **complete GitHub release notes**. Keep all actual technical and user-facing
  changes in the canonical `items` list. Follow release preparation, synchronize
  shared versions and generate `CHANGELOG.md`. Do not edit generated or
  historical notes by hand or create a competing GitHub changelog.
- Website `/patch-notes` is **not** the complete engineering changelog. Show
  only features, UI/UX improvements, user-visible bug fixes and other verified
  outcomes that matter to website or bot users. Exclude CI, build systems,
  deployment plumbing, routine dependency bumps, internal-only refactors,
  experimental code not in the served build, secret/security internals and
  planned work. A release with only internal changes has no public patch-note
  entry. Avoid overstating external services, live audio or deployment status.
- **Implementation gap:** the current `app/patch-notes/page.tsx` directly
  renders every item in `lib/releases.json`. These instructions alone do not
  filter existing notes. Implement and test an explicit public-note selection in
  the release data and page before asserting website/GitHub separation works.
  Preserve complete GitHub history and existing release identifiers; never
  silently delete internal notes as a shortcut. Track this in a separate code
  change with tests and a draft PR when doing the UI work.
- Check related open PRs for proposed versions. Before submission and again
  before merge, refresh the target branch and reconcile competing version entries
  against the combined changes. Preserve other work and rerun release validation.
- For user-facing website or Core changes, verify `/patch-notes` renders only
  the intended **public** entry, with the correct build version and link from
  the welcome page (`app/patch-notes/page.tsx` and `app/afterparty.tsx`).
  Check the displayed title and bullets in a local preview, including mobile
  when layout changes. For internal-only releases, verify no user-facing entry
  appears. Validate that the generated GitHub notes still contain all technical
  items. An import check is not a visual check; report preview limitations and
  never deploy merely to validate notes.
- Isolated Rust experiment code targeting `dev` still needs scoped patch notes
  in the PR, explicitly marked offline/experimental with checks and limitations.
  It does not change the product version or advertise unadopted experiments on
  the production website. Adoption into `main` requires a separate owner decision,
  reviewed PR and product release notes.
- Internal documentation-only changes record their outcome in the PR with a
  release-note impact statement. They do not require a product version bump,
  website patch-note entry or GitHub Release draft. Documentation that changes
  user-facing instructions, terms or expected behavior needs relevant product
  notes. A missing note is not excused by calling a code change maintenance.

The PR must identify its notes source, website relevance, version decision and
checks actually run. If GitHub Release draft creation is unavailable, include the
generated body in the PR and report the blocker. Never publish as a workaround.
Owner approval is required before merge, auto-merge, release publication or
deployment. Cloud tasks stop at review material.

## Prepare a release in a pull request

1. Prepend an entry to `lib/releases.json`, newest first. Use an ISO date,
   an English title and concrete, complete **GitHub** release-note bullets.
   Public website notes must be explicitly selected by the reviewed UI/data
   implementation, not generated from all technical bullets by default.
   Preserve historical versions, titles and full GitHub item content.
2. Set the same version in both `package.json` files and both `package-lock.json`
   files, including each lockfile's `packages[""].version`. Do not change dependency
   versions as part of a product version bump.
3. Run `npm run release:changelog`. The generated `CHANGELOG.md` includes all
   historical entries from `lib/legacy-updates.ts` in their original language.
4. Run `npm run setup:cloud` and `npm run check:all`. Local and GitHub CI tests
   reject version drift and stale generated release notes.
5. Push a separate branch and open a draft PR. If stacked on an unmerged PR,
   state that dependency and retain its changes. Do not publish a release as
   though the branch were deployed.
6. Generate the exact GitHub body with
   `node scripts/releases.ts --notes > /tmp/afterparty-release-notes.md`.
   Do not use `npm run` output redirected to a file: npm adds script headers.
7. Create a **draft** GitHub Release using the new `vX.Y.Z` tag name, the exact
   tested branch commit as its target and the generated notes as its body.
   A draft is review material. It does not mean production has been deployed.

## After review and merge (maintainer action)

Before publishing, regenerate notes from the reviewed, merged source and set the
unpublished draft's target to that exact merged commit. Verify that the version,
notes and green CI match it. If the proposed tag already exists, verify its target;
do not move it. A maintainer may then publish the release and create its new tag.
Production deployment is a separate local operation following
[operations and recovery](../services/core/PUBLIC_RELEASE.md). A GitHub Release
alone is not deployment evidence. Cloud tasks do not merge, publish or deploy.

## Reading release history

Website and Core use semantic versioning. Historical release entries retain their original numbering. Patch notes describe the source build; a build is not proof of a production deployment. Published release artifacts are listed in [GitHub Releases](https://github.com/lukasvri/Afterparty-MusicBot/releases).
