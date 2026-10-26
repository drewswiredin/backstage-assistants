# Artist Engagement Portal

The **artist-engagement-portal** system is how artists and their teams manage
their presence: the public artist page, listener insights, and profile edits.
It belongs to the **artists** domain and is owned by **team-a**.

| Component                                                      | Type    | What it does                                         |
| -------------------------------------------------------------- | ------- | ---------------------------------------------------- |
| [www-artist](/catalog/default/component/www-artist/docs)       | website | The artist-facing site: profile, insights, releases  |
| [artist-lookup](/catalog/default/component/artist-lookup/docs) | service | Resolves artists by id, name, or external identifier |

It depends on the **artists-db** resource, the source of truth for artist
profiles.

## Who uses it

- **Artists and managers** edit their profile and see listener numbers.
- **Label staff** manage several artists from one account.
- **Internal teams** call artist-lookup to show artist names and images.

## Service levels

| Signal                      | Target                           |
| --------------------------- | -------------------------------- |
| artist-lookup availability  | 99.99%                           |
| artist-lookup latency (p99) | under 50 ms                      |
| Insights freshness          | yesterday's numbers by 06:00 UTC |
