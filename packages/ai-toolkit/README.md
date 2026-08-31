# @mmajewski-fp/ai-toolkit

Team AI artifacts — skills and rules — distributed as a private npm package
through GitHub Packages. Installing it drops the team's `code-review` skill into
a consumer repo's `.claude/skills/` and merges the team rules into its `CLAUDE.md`.

## What you get

| Artifact | Installed to |
|---|---|
| `code-review` skill | `.claude/skills/code-review/` |
| Team rules block | `CLAUDE.md`, between sentinel markers |
| Install record | `.claude/.ai-toolkit-manifest.json` |

## Consumer setup

**1. Map the scope to GitHub Packages.** Commit an `.npmrc` at the consumer repo
root containing only the registry mapping:

```
@mmajewski-fp:registry=https://npm.pkg.github.com
```

Never commit a token to this file.

**2. Authenticate.** GitHub Packages requires auth even to *read* a private
package.

- *Local development* — `npm login --scope=@mmajewski-fp --registry=https://npm.pkg.github.com`, or a `_authToken` line in your user-level `~/.npmrc`. A classic PAT with `read:packages` works.
- *CI* — provide a token via environment. GitHub Actions in the same org can use the built-in `GITHUB_TOKEN`; anything else needs its own secret:

  ```yaml
  - run: npm ci
    env:
      NODE_AUTH_TOKEN: ${{ secrets.GH_PKG_TOKEN }}
  ```

  If your CI cannot write `.npmrc` from `setup-node`, this `preinstall` helper
  appends the token line at install time:

  ```json
  "preinstall": "[ -n \"$GH_PKG_TOKEN\" ] && echo '//npm.pkg.github.com/:_authToken=${GH_PKG_TOKEN}' >> .npmrc || true"
  ```

**3. Install.**

```bash
npm install --save-dev @mmajewski-fp/ai-toolkit
```

`postinstall` does the rest. Commit the resulting `.claude/skills/` and `CLAUDE.md`
changes so teammates without the package still get the artifacts.

## Updating and removing

```bash
npm update @mmajewski-fp/ai-toolkit   # re-runs install, refreshing managed content
npx ai-toolkit uninstall              # removes managed files and the CLAUDE.md block
npm uninstall @mmajewski-fp/ai-toolkit
```

`npm uninstall` does **not** run the removal automatically — npm dropped
`preuninstall` lifecycle support for dependencies. Run `npx ai-toolkit uninstall`
first, while the package is still present.

## Your edits are safe

The manifest records a SHA-256 for every installed file.

- On **update**, a file whose hash no longer matches is treated as yours: it is kept, not overwritten, and you get a warning naming the file.
- On **uninstall**, the same check applies — edited files are left behind rather than deleted.
- In `CLAUDE.md`, only the content between `<!-- BEGIN @mmajewski-fp/ai-toolkit -->` and `<!-- END @mmajewski-fp/ai-toolkit -->` is managed. Everything outside the markers is yours and is never touched.

A consequence worth knowing: an edited skill file stops receiving updates. To take
the packaged version again, delete your copy and re-run `npm install`.

## Failure behavior

`postinstall` never fails a consumer's `npm install`. If the toolkit cannot
identify a project root, or a write fails, it logs a warning prefixed
`[@mmajewski-fp/ai-toolkit]` and exits successfully. A broken toolkit must not
block a dependency install — so check for that warning if artifacts don't appear.

## Publishing

Version, then push to `main` — CI publishes on push.

```bash
npm version patch
git push && git push --tags
```

The scope must match the repository owner; GitHub Packages rejects a mismatch.
Changing teams means changing `name`, `publishConfig`, the `.npmrc` mapping, and
the sentinel markers together.
