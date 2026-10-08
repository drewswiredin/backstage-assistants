# Releasing

Three packages publish from this repo:

| Directory                     | Package                                             |
| ----------------------------- | --------------------------------------------------- |
| `packages/assistants-common`  | `@drewswiredin/backstage-plugin-assistants-common`  |
| `packages/assistants-backend` | `@drewswiredin/backstage-plugin-assistants-backend` |
| `packages/assistants`         | `@drewswiredin/backstage-plugin-assistants`         |

The frontend and backend depend on `-common` via a caret range, so bump
`-common` first.

## 1. Version and changelog

1. Bump `version` in the three `package.json` files that change, `-common`
   first. When `-common` bumps, update the range the other two declare for it.
2. Move each package's `Unreleased` entries in its `CHANGELOG.md` under the new
   version and date.
3. `yarn install` to refresh the lockfile.

## 2. Verify

```bash
yarn tsc && yarn lint:all && yarn prettier:check && yarn test && yarn build:all
```

## 3. Pack and inspect

Per package:

```bash
cd packages/<p>
npm pack
tar -xOf drewswiredin-backstage-plugin-<p>-<version>.tgz package/package.json
```

In the extracted `package.json`:

- no dependency value starts with `patch:` or `workspace:`;
- `exports` (and `main`, `types`) point at `dist/`, not `src/`.

## 4. Publish from the tarball

```bash
npm publish ./drewswiredin-backstage-plugin-<p>-<version>.tgz --access public
```

Publish the tarball, never the directory: publishing the directory leaves the
registry document with the pre-`prepack` `./src` exports. Publish `-common`
first, then the backend and frontend.

Verify each:

```bash
npm view @drewswiredin/backstage-plugin-<p>@<version> exports main
```

## 5. Commit and tag

```bash
git commit -s -m "chore(release): common X, backend Y, frontend Z"
git tag assistants-common-v<X>
git tag assistants-backend-v<Y>
git tag assistants-v<Z>
git push --follow-tags
```

One tag per published package, from the next release on; skip the tag for a
package that did not publish.

## 6. Consumer check

In a throwaway directory, install what the registry serves and prove it loads
and bundles:

```bash
mkdir /tmp/assistants-check && cd /tmp/assistants-check
npm init -y
npm install react@18 react-dom@18 react-router-dom@6 \
  @drewswiredin/backstage-plugin-assistants@<Z> \
  @drewswiredin/backstage-plugin-assistants-backend@<Y> \
  @drewswiredin/backstage-plugin-assistants-common@<X>
node -e "require('@drewswiredin/backstage-plugin-assistants-backend')"
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
