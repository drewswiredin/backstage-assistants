# Marketplace listings

Two routes, each with a ready-to-use file in this folder.

## backstage.io plugin directory

`backstage-directory-entry.yaml` is the entry for the [backstage.io plugin directory](https://backstage.io/plugins). Preconditions: the repo is public, and the README that the `documentation` link lands on shows screenshots (the directory card shows only the icon).

In a fork of `backstage/backstage`:

1. Copy the entry to `microsite/data/plugins/assistants.yaml`.
2. Copy `docs/images/icon.png` to `microsite/static/img/assistants-logo.png` (the entry's `iconUrl`).
3. Set `addedDate` to the day of the PR.
4. `yarn install && node ./scripts/verify-plugin-directory.js`
5. Commit with `git commit -s` (DCO is enforced before review) and open the PR.

## Red Hat Developer Hub Extensions catalog

`extensions-plugin-entity.yaml` is a `Plugin` entity (`extensions.backstage.io/v1alpha1`) for the Extensions catalog in RHDH, ingested by `@red-hat-developer-hub/backstage-plugin-extensions`. It carries the listing: title, description, highlights, icon, and install notes. Two ways to ingest it:

- A catalog `Location` in the consuming instance, `type: url`, target `https://github.com/drewswiredin/backstage-assistants/blob/main/docs/marketplace/extensions-plugin-entity.yaml`, with `rules: [{ allow: [Plugin] }]`.
- The Extensions catalog-index directory, which RHDH loads at startup.

An installable listing (install button, dynamic-plugin packaging) is the follow-on route: an overlays workspace in `redhat-developer/rhdh-plugin-export-overlays` with the public GitHub source pinned to a ref and `repo-flat: true`, a `plugins-list.yaml`, `Package` entities carrying `appConfigExamples`, and a published dynamic-plugin OCI artifact.
