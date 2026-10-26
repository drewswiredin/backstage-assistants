# Runbook

## Feed ingestion delayed

1. Check the `feeds.lag` dashboard. Lag above 20 minutes pages team-b.
2. A single huge feed (over 5,000 items) can stall a worker; the worker log
   names it. Move it to the slow lane with the admin endpoint
   `POST /admin/feeds/{id}/slow-lane`.
3. If every feed is late, check outbound network from the worker pool.

## Progress not syncing between devices

Usually a client sending `seek: true` on every update. Find the client
version in the request logs and raise it with that client team.

## Database

Postgres, 3 replicas. Episode tables are partitioned by show id. Never run
unbounded queries on `episodes` against the primary.
