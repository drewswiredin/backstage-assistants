# Releasing

Four packages publish from this repo:

| Directory                                            | Package                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/assistants-common`                         | `@drewswiredin/backstage-plugin-assistants-common`                         |
| `packages/assistants-backend`                        | `@drewswiredin/backstage-plugin-assistants-backend`                        |
| `packages/assistants`                                | `@drewswiredin/backstage-plugin-assistants`                                |
| `packages/assistants-backend-module-semantic-search` | `@drewswiredin/backstage-plugin-assistants-backend-module-semantic-search` |

The frontend and backend depend on `-common` via a caret range, so bump
`-common` first.

Releases are cut on `main`. Start by bringing it up to `dev`:

```bash
git checkout main
git merge --ff-only dev
```

## 1. Backstage ranges

```bash
yarn backstage-cli versions:bump
yarn dedupe --check '@backstage/*'
```

Every `@backstage/*` range in the published packages must match the current
Backstage release, or a consumer on that release installs a second copy of
each lagging package (`^0.0.x` ranges match one version only). The bump also
moves `backstage.json`; move the "Backstage N or later" floor in the READMEs
and add "Backstage dependency ranges track the N release line" to each
changed package's changelog. CI runs the dedupe check.

## 2. Version and changelog

1. Bump `version` in each `package.json` that changes, `-common`
   first. When `-common` bumps, update the range the frontend and backend declare
   for it.
2. Move each package's `Unreleased` entries in its `CHANGELOG.md` under the new
   version and date.
3. `yarn install` to refresh the lockfile.

## 3. Verify

```bash
yarn tsc && yarn lint:all && yarn prettier:check && yarn test && yarn build:all
```

## 4. Pack and inspect

Per package (`*.tgz` is gitignored):

```bash
cd packages/<p>
npm pack
tar -xOf drewswiredin-backstage-plugin-<p>-<version>.tgz package/package.json
```

In the extracted `package.json`:

- no dependency value starts with `patch:` or `workspace:`;
- `exports` (and `main`, `types`) point at `dist/`, not `src/`.

## 5. Publish from the tarball

```bash
npm publish ./drewswiredin-backstage-plugin-<p>-<version>.tgz --access public
```

Publish the tarball, never the directory: publishing the directory leaves the
registry document with the pre-`prepack` `./src` exports. Publish `-common`
first, then the backend, the semantic search module, and the frontend.

Verify each:

```bash
npm view @drewswiredin/backstage-plugin-<p>@<version> exports main
```

## 6. Commit and tag

```bash
git commit -s -m "chore(release): common X, backend Y, frontend Z, semantic search S"
git tag -a assistants-common-v<X> -m "assistants-common v<X>"
git tag -a assistants-backend-v<Y> -m "assistants-backend v<Y>"
git tag -a assistants-v<Z> -m "assistants v<Z>"
git tag -a assistants-backend-module-semantic-search-v<S> -m "assistants-backend-module-semantic-search v<S>"
git push --follow-tags origin main
git checkout dev
git merge --ff-only main
git push origin dev
```

Tags are annotated so `--follow-tags` pushes them. One tag per published
package; skip the tag for a package that did not publish.

## 7. Consumer check

In a throwaway directory, install what the registry serves and prove it loads
and bundles:

```bash
mkdir /tmp/assistants-check && cd /tmp/assistants-check
npm init -y
npm install react@18 react-dom@18 react-router-dom@6 \
  @drewswiredin/backstage-plugin-assistants@<Z> \
  @drewswiredin/backstage-plugin-assistants-backend@<Y> \
  @drewswiredin/backstage-plugin-assistants-common@<X> \
  @drewswiredin/backstage-plugin-assistants-backend-module-semantic-search@<S>
node -e "require('@drewswiredin/backstage-plugin-assistants-backend')"
node -e "require('@drewswiredin/backstage-plugin-assistants-backend-module-semantic-search')"
printf "import '@drewswiredin/backstage-plugin-assistants/alpha';\n" > entry.mjs
npx esbuild entry.mjs --bundle --platform=browser --outfile=/dev/null \
  --loader:.svg=dataurl
```

`--loader:.svg=dataurl` stands in for the app bundler's asset handling:
`@backstage/core-components` imports `.svg` files.

A missing-export error from `esbuild` means a mismatched `@assistant-ui/*` or
AI SDK family; `yarn tsc` and `yarn add` do not catch that.

## Yarn's age gate

Yarn resolves a package version through `npmMinimalAgeGate` (3 days in a
create-app, 1 week on stable), so a create-app consumer running
`yarn add <pkg>` sees the release after 3 days. `yarn add <pkg>@<version>`
resolves the exact version immediately.
