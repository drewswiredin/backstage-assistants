# Operations

## Index rebuild

The index can be rebuilt from the WARC files alone. A full rebuild takes
several days; partial rebuilds by capture day are routine after a storage
incident.

## Serving latency

Lookups should answer within 100 ms at p95. Slow lookups usually mean a cold
index shard; they warm up within minutes of traffic.

## Removal requests

Applied through `POST /admin/exclusions` by the trust and safety team; storage
only enforces them.
