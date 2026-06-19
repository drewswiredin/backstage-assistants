# Marketplace metadata

Artifacts for listing this plugin across the Backstage ecosystem. See the
"Publishing to the marketplace" section of the top-level README for the full
how-to; this folder holds the ready-to-use files.

- **`backstage-directory-entry.yaml`** — entry for the official
  [backstage.io plugin directory](https://backstage.io/plugins). Copy it into the
  `backstage/backstage` repo at `microsite/data/plugins/assistants.yaml`, run
  `node ./scripts/verify-plugin-directory.js`, and open a PR. The directory card
  shows only the icon — screenshots come from this repo's README (`documentation`).

- **`extensions-plugin-entity.yaml`** — a `Plugin` entity for the in-product
  Backstage **Extensions** / Marketplace catalog (Red Hat Developer Hub and the
  community marketplace plugin). Register it via a catalog `Location` in a
  consuming instance. Screenshots/icon are first-class here (`spec.assets` /
  `spec.icon`).

Both reference assets in [`../images/`](../images) by absolute raw URL pinned to
the `v1.0.0` tag — bump that tag when you cut a new release.
