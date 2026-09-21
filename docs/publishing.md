# Publishing a Pi Package

This guide covers the general requirements for publishing a Pi package through npm and the release procedure used by `pi-acp-delegate`.

## How Pi package discovery works

A Pi package is an npm, Git, or local package that exposes extensions, skills, prompt templates, or themes through its `package.json` manifest or Pi's conventional directories.

For npm discovery, include the `pi-package` keyword. The [Pi package gallery](https://pi.dev/packages) displays npm packages tagged with that keyword. The official documentation does not describe a separate gallery submission process, a manual refresh action, or an indexing service-level agreement. Gallery indexing is asynchronous, so a successfully published package may not appear immediately.

## Package manifest

A minimal manifest for this extension has the following shape:

```json
{
  "name": "pi-acp-delegate",
  "version": "x.y.z",
  "keywords": ["pi-package"],
  "files": [
    "index.ts",
    "src",
    "examples",
    "README.md",
    "LICENSE"
  ],
  "publishConfig": {
    "access": "public"
  },
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```

Manifest resource paths are relative to the package root. Pi also supports glob patterns and exclusions in resource arrays.

The gallery can display an optional preview configured under `pi`:

```json
{
  "pi": {
    "extensions": ["./index.ts"],
    "video": "https://example.com/demo.mp4",
    "image": "https://example.com/screenshot.png"
  }
}
```

`video` supports MP4. `image` supports PNG, JPEG, GIF, and WebP. Video takes precedence when both fields are present.

## Dependencies

Place third-party runtime libraries in `dependencies`. For this package, that includes the ACP SDK and the default Codex ACP implementation.

Pi core packages imported by an extension belong in `peerDependencies` with a `"*"` range and in `devDependencies` at versions used for local type checking and tests. The relevant core packages include `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox`; declare only the packages the extension actually imports.

When a package consumes resources from another Pi package, the official documentation requires that dependency in both `dependencies` and `bundledDependencies`, with its resources referenced through `node_modules/` manifest paths. This is not needed for ordinary runtime libraries that do not register Pi resources.

## One-time setup

Before the first release:

1. Verify the active npm account is the intended publisher:

```sh
npm whoami
```

2. Check package-name availability:

```sh
npm view pi-acp-delegate
```

A `404 Not Found` means the package was unpublished at the time of that check. It does not reserve the name.

3. Ensure the public repository and npm metadata agree:

```sh
npm pkg get name repository homepage bugs author
```

4. Verify the required Node.js version and clean Git state:

```sh
node --version
git status --short
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
```

Do not print npm tokens, GitHub credentials, or one-time passwords in logs or release notes.

## Prepare a version

Choose the version according to semantic versioning. npm package versions are immutable: an existing `pi-acp-delegate@0.1.0` cannot be overwritten with different contents.

For a patch release, update `package.json` and `package-lock.json` together without creating a tag yet:

```sh
npm version patch --no-git-tag-version
```

For a specific version, set `VERSION` to the intended semantic version before running:

```sh
VERSION=x.y.z
npm version "$VERSION" --no-git-tag-version
```

Update release notes or a changelog when applicable. Review the version diff and commit it normally; do not create the release tag until the published artifact has passed runtime verification.

## Preflight checks

Run from the repository root:

```sh
git status --short
git diff --check
npm ci
npm run typecheck
npm test
npm audit --omit=dev
npm publish --dry-run --json
npm pack --dry-run --json
```

The current package should contain:

- `index.ts`
- `src/`
- `examples/codex/README.md`
- `examples/codex/run.sh`
- `README.md`
- `LICENSE`
- `package.json`

Verify that `examples/codex/run.sh` retains executable mode. The tarball must not contain tests, local-only documentation, credentials, `.env` files, logs, temporary probes, or machine-specific configuration.

Inspect the dry-run output for:

- the intended package name and version
- the `pi-package` keyword
- `pi.extensions` pointing to `./index.ts`
- correct repository metadata
- the expected file count and paths
- no unexpected bundled dependencies

`npm pack --dry-run` does not leave an archive. To inspect the exact archive, run `npm pack`, inspect the resulting `.tgz`, and remove it afterward:

```sh
VERSION=x.y.z
npm pack

tar -tzf "pi-acp-delegate-${VERSION}.tgz"
rm "pi-acp-delegate-${VERSION}.tgz"
```

Before publication, commit and push the release code so the public repository contains the exact source being published:

```sh
git status --short
git push origin main
```

Confirm `HEAD` and `origin/main` identify the same commit.

## Publish to npm

Publishing is an external, effectively irreversible release action:

```sh
npm publish --access public
```

The `prepublishOnly` script reruns type checking and tests. npm may request a 2FA one-time password.

If the command times out or returns an ambiguous result, do not immediately retry. First ask the registry whether the version exists:

```sh
VERSION=x.y.z
npm view "pi-acp-delegate@${VERSION}" version dist.integrity dist.tarball
```

Retry only after confirming the version was not published.

## Verify the registry artifact

Set `VERSION` to the version just published:

```sh
VERSION=x.y.z
npm view "pi-acp-delegate@${VERSION}" \
  name version description keywords pi repository dependencies \
  dist-tags dist.integrity dist.shasum dist.tarball dist.fileCount --json
```

Check that:

- the version is correct
- `latest` points to it only when that was intended
- `keywords` contains `pi-package`
- `pi.extensions` contains `./index.ts`
- repository and dependency metadata are correct
- the integrity, tarball URL, and file count are present

Optionally download the published artifact and inspect its checksum and file list:

```sh
VERSION=x.y.z
workdir=$(mktemp -d)
(
  cd "$workdir"
  npm pack "pi-acp-delegate@${VERSION}"
  shasum -a 1 "pi-acp-delegate-${VERSION}.tgz"
  tar -tzf "pi-acp-delegate-${VERSION}.tgz" | sort
)
rm -rf "$workdir"
```

Compare the checksum and contents with the release preflight evidence.

## Verify through Pi

Use a separate temporary or target repository and pin the published version:

```sh
VERSION=x.y.z
cd /path/to/test-repository
pi -e "npm:pi-acp-delegate@${VERSION}"
```

The `-e` form installs the package into a temporary directory for that run and does not add it to Pi settings.

In Pi:

1. Run `/acp`.
2. Confirm the default Agent is `Codex ACP` and active invocations are `0`.
3. Confirm the command resolves the package-local Codex ACP executable.
4. If credentials and quota are intentionally available, run one small read-only `acp_delegate` task and confirm no files changed.

Persistent installation can be checked separately:

```sh
VERSION=x.y.z
pi install "npm:pi-acp-delegate@${VERSION}"
pi list
```

This changes Pi user settings and installs a pinned version. Remove or update that entry after testing according to the intended user configuration.

## Tag and GitHub release

Create the Git tag only after npm metadata, artifact contents, and the Pi runtime check pass. The tag must point to the exact commit used for the tested package.

Set the released version without the leading `v`:

```sh
VERSION=x.y.z
git status --short
git tag -a "v${VERSION}" -m "Release v${VERSION}" HEAD
git push origin "v${VERSION}"
```

Verify the remote tag and its peeled commit:

```sh
git ls-remote origin "refs/tags/v${VERSION}" "refs/tags/v${VERSION}^{}"
```

Create a non-draft GitHub Release for that tag. Release notes should summarize user-visible changes, mention important compatibility or security constraints, and include the installation command:

```sh
pi install npm:pi-acp-delegate
```

Do not move a published release tag to different source code.

## Gallery indexing

After npm publication, check the [Pi package gallery](https://pi.dev/packages) for `pi-acp-delegate`. The `pi-package` keyword is the documented discovery requirement, but indexing may lag behind npm publication.

Do not republish the same version, and do not create a new package version solely to force gallery indexing. If the package remains absent after a reasonable interval:

1. Recheck the public npm metadata, especially `keywords` and `pi`.
2. Confirm the package is public and its tarball is accessible.
3. Report the package name, version, and npm publication time through the Pi project's issue or support channel.

## Failure and recovery

Before npm publication, fix issues normally, rerun the complete preflight, and update the release commit as needed.

After npm publication:

- Never reuse the published version for different contents.
- Never move its release tag to a different commit.
- Do not use npm unpublish as a routine rollback mechanism.
- If a release is unsafe or unusable, deprecate it with a clear reason and publish a corrected patch version.

Example:

```sh
BAD_VERSION=x.y.z
FIXED_VERSION=x.y.z
npm deprecate "pi-acp-delegate@${BAD_VERSION}" \
  "Use ${FIXED_VERSION}: describe the issue briefly"
npm version patch --no-git-tag-version
```

Then repeat the full preflight, commit and push the fix, publish the new version, perform registry and Pi runtime verification, and create a new tag and release.

## Release checklist

- [ ] Version follows semantic versioning and package files are coherent.
- [ ] `main` is clean, reviewed, and synchronized with `origin/main`.
- [ ] Type checking, tests, and production dependency audit pass.
- [ ] npm publish and pack dry-runs contain only expected files.
- [ ] Release commit is pushed before npm publication.
- [ ] npm publication succeeds or registry state is checked before retrying.
- [ ] Registry metadata, integrity, and tarball contents are verified.
- [ ] The pinned npm version loads through `pi -e`.
- [ ] `/acp` and an intentional read-only delegation smoke test pass.
- [ ] Annotated Git tag points to the tested release commit.
- [ ] GitHub Release is public and includes the installation command.
- [ ] Gallery discovery is checked without republishing to force refresh.

## References

- [Official Pi package documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)
- [pi-acp-delegate on npm](https://www.npmjs.com/package/pi-acp-delegate)
- [pi-acp-delegate repository](https://github.com/SyJarvis/pi-acp-delegate)
- [Pi package gallery](https://pi.dev/packages)
