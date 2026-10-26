# Artist Lookup

**artist-lookup** resolves artists: by internal id, by name, or by an
external identifier such as an ISNI. Part of the
[artist-engagement-portal](/catalog/default/system/artist-engagement-portal/docs)
system, owned by **team-a**. A Java (Spring Boot) service created from the
Spring Boot template.

## API

| Endpoint                     | What it does               |
| ---------------------------- | -------------------------- |
| `GET /artists/{id}`          | One artist                 |
| `POST /artists:batchGet`     | Up to 200 artists by id    |
| `GET /artists:search?q=`     | Name search, typo-tolerant |
| `GET /artists:resolve?isni=` | By external identifier     |

## Performance

99.99% availability and under 50 ms at p99. A two-tier cache absorbs over
98% of reads; the source of truth is the **artists-db** resource.

## Consumers

The biggest callers are [www-artist](/catalog/default/component/www-artist/docs),
the mobile apps (artist pages), and the recommendations pipeline.
