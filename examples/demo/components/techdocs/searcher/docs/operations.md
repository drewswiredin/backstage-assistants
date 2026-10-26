# Operations

## Reindex

A full reindex takes about 40 minutes and runs nightly at 02:00 UTC. To run
one by hand: `POST /admin/reindex` (needs the search-admin role).

## Relevance changes

Every ranking change runs as an A/B test for at least a week. The headline
metric is "search to play within 30 seconds".

## Alerts

- Suggest latency above 50 ms at p95 for 10 minutes.
- Zero-result rate above 8%: usually a broken analyzer after a deploy.
