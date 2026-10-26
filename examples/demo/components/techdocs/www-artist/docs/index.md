# Artist Website

**www-artist** is where artists and their teams manage their presence on
ACME. Part of the
[artist-engagement-portal](/catalog/default/system/artist-engagement-portal/docs)
system, owned by **team-a**. A server-rendered React site.

## Features

- **Profile**: bio, images, links, and verified social accounts.
- **Insights**: listeners, streams, and top cities, updated daily by 06:00
  UTC.
- **Releases**: upcoming releases and pre-save links.
- **Team**: invite managers and label staff with roles (viewer, editor,
  admin).

## Dependencies

Reads through [artist-lookup](/catalog/default/component/artist-lookup/docs),
writes through the profile API. Insights come from the daily aggregates.
