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

**GitHub is the complete change record.** Every code, dependency, security,
configuration, test, infrastructure and documentation change must be described
truthfully in its commit(s) and PR. Keep the PR description current with actual
behavior, affected components, checks run, compatibility/operator actions and
limitations. Proposed or unverified work is not an implemented change.

**The public website has a deliberately narrower audience.** Currently
`apps/web/src/routes/patch-notes/+page.svelte` renders every `lib/releases.json` entry, and
`CHANGELOG.md` and GitHub Release bodies are generated from that same product
source. There is no separate per-item website visibility filter. Therefore:

- Add a product entry to `lib/releases.json` **only when preparing a real,
  test-backed, user-facing product release**. Include concrete changes that
  affect the user, for example fixed searches, improved player behavior,
  visible interface refinements or usable new features. Describe the actual
  implementation and limitations in understandable English.
- Do **not** put internal refactors, dependency version changes, build work,
  CI/testing, infrastructure, hypothetical features, unfinished experiments,
  migration preparation or housekeeping into website-facing notes simply
  because work occurred. Record all that work in GitHub commits and PRs.
  Technical implementation details can accompany the related PR rather than
  being repeated in the product changelog.
- An internal-only change does not by itself require a new product version,
  `lib/releases.json` entry, website note or GitHub Release draft. When it
  later contributes to a user-facing product release, summarize only its
  observable benefit in that release, if any. GitHub retains the full audit
  trail even when a change never needs a public patch note.
- For actual product releases, update the canonical `lib/releases.json`,
  synchronize the version and regenerate `CHANGELOG.md` with the existing
  script. Preserve historical entries and do not maintain a competing release
  source or edit generated changelog content by hand.
- Before submission and again before merge, inspect concurrent PRs, refresh
  the target branch and reconcile competing version candidates without
  discarding other work. Validate the resulting release history.
- Verify that `/patch-notes` shows exactly the relevant product entries and
  the homepage points to the right version (`apps/web/src/routes/patch-notes/+page.svelte` and
  `apps/web/src/routes/+page.svelte`). Review a local desktop/mobile preview for layout or
  public note changes. A data/import check alone is not a visual check.
  The website displays source-build notes only after that build is deployed.
  Neither a branch, passing CI nor a release draft proves a production rollout;
  for Core-dependent claims verify the installed compatible Core separately.
- Isolated Rust experiment code targeting `dev` needs accurate scoped notes
  in its GitHub PR with test and feasibility limits, not website product notes
  or an implied release. Owner approval is still required to resume Rust
  testing or adopt it into `main`.
- Internal documentation-only changes record outcome and release-note impact
  in the PR, without a product version bump or website note. User-facing
  instruction changes can be described in product notes when they are
  genuinely relevant to users.

Each PR identifies GitHub change notes, whether a website product note applies,
the version decision, checks actually run and limitations. When a user-facing
GitHub Release draft cannot be created, include the generated release body in
its PR rather than publishing as a workaround. Merging, auto-merge, release
publication and deployment need explicit owner approval. Cloud tasks stop
at review material.

## Prepare a release in a pull request

1. For a genuine user-facing product release, prepend an entry to
   `lib/releases.json`, newest first. Use an ISO date, a truthful English title
   and concrete user-relevant bullets. This is the shared product-note source
   for the website and generated GitHub notes. Preserve existing entries.
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

Website and Core use semantic versioning. Historical release entries retain their original numbering. Public patch notes summarize real, relevant product changes in the source build, not every internal change recorded in GitHub. A build is not proof of production deployment. Published release artifacts are listed in [GitHub Releases](https://github.com/lukasvri/Afterparty-MusicBot/releases).
