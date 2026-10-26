# Runbook

## Cache hit rate below 95%

Usually a deploy that changed the cache key format. Roll back, or wait out the
warm-up (about 10 minutes at peak traffic).

## Stale artist names after a merge

Merges take effect after the cache TTL (10 minutes). To force it, call
`POST /admin/cache/evict` with the affected artist ids.

## artists-db failover

Reads keep working from the cache for up to 10 minutes; writes (profile
edits) fail and www-artist shows a "try again later" banner. No action needed
unless the failover takes longer than that.
