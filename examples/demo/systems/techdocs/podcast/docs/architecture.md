# Architecture

```
listener ──> queue-proxy (web) ──> podcast-api ──> Postgres (shows, episodes)
                                        │
                                        └──> progress store (DynamoDB-style KV)
RSS feeds ──> feed ingester (podcast-api worker) ──> Postgres
```

## Progress sync

Each client reports its position every 10 seconds while playing and on pause.
podcast-api keeps the furthest position per listener and episode, so a phone
and a laptop never fight: whichever got further wins, unless the listener
explicitly seeks backwards (sent as `seek: true`).

## Feed ingestion

The ingester polls each feed every 15 minutes with conditional requests
(`If-None-Match`). Feeds that fail five times in a row are marked unhealthy and
polled hourly until they recover; the show's owner is emailed once.

## Limits

- 3,000 episodes per show are listed; older ones are reachable by search.
- Audio is never re-hosted; episodes stream from the publisher's host through
  the CDN cache.
