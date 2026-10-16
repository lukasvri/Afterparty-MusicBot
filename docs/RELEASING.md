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

For a release containing several changes, use the largest applicable increment.
Continue from the current shared version; do not reinterpret historical V36 as `36.0.0`.
The tested `nextVersion` helper in `scripts/releases.ts` encodes these rules.

## Prepare a release in a pull request

1. Prepend an entry to `lib/releases.json`, newest first. Use an ISO date,
   an English title and concrete release-note bullets. This is the shared source
   for the website and GitHub notes. Preserve existing entries.
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
