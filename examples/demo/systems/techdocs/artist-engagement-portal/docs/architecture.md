# Architecture

- **www-artist** is a server-rendered React site. It talks only to
  artist-lookup for reads and to the profile API for writes.
- **artist-lookup** is a read-heavy service in front of **artists-db**, with a
  two-tier cache (in-process LRU, then a shared cache) that absorbs over 98%
  of reads.
- Insights are computed nightly from play events and stored as daily
  aggregates; www-artist reads them directly.

## Identity of an artist

An artist has one internal id and any number of external identifiers (ISNI,
label catalog numbers). artist-lookup resolves all of them; merging two
artist records is done by the data stewards in team-a and takes effect after
the next cache expiry (at most 10 minutes).

## Permissions

Artist accounts are linked to artist ids by verified claims. A label account
can act for every artist it has a claim on. All profile edits are audited.
