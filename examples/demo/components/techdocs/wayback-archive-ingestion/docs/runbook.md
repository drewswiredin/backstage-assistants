# Runbook

## Frontier growing without bound

The fetchers are falling behind. Check for a host returning slow responses
that pins fetcher slots; add it to the slow-host list.

## Host complaints about crawl rate

Lower that host's rate with `POST /admin/hosts/{host}/rate` (requests per
second). Reply to the complaint with the new rate.

## Writers failing

Usually storage is rejecting writes (quota or a storage-side incident). Pause
the writers; the fetched pages queue on disk for up to 6 hours.
