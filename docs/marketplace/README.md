# Marketplace listing

`backstage-directory-entry.yaml` is the entry for the [backstage.io plugin directory](https://backstage.io/plugins). Preconditions: the repo is public, and the README that the `documentation` link lands on shows screenshots (the directory card shows only the icon).

In a fork of `backstage/backstage`:

1. Copy the entry to `microsite/data/plugins/assistants.yaml`.
2. Copy `docs/images/icon.png` to `microsite/static/img/assistants-logo.png` (the entry's `iconUrl`).
3. Set `addedDate` to the day of the PR.
4. `yarn install && node ./scripts/verify-plugin-directory.js`
5. Commit with `git commit -s` (DCO is enforced before review) and open the PR.
