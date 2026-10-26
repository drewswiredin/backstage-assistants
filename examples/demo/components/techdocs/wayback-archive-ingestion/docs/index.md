# Wayback Archive Ingestion

The ingestion subsystem of the
[wayback archive](/catalog/default/component/wayback-archive/docs). Owned by
**team-d**.

## Pipeline

1. **Frontier**: the list of URLs to crawl, prioritized by popularity and
   time since the last capture.
2. **Fetchers**: a pool of crawlers that respect `robots.txt` and crawl each
   host at most once per second.
3. **Writers**: package fetched pages as WARC records and hand them to
   [wayback-archive-storage](/catalog/default/component/wayback-archive-storage/docs).

Roughly 40 million captures a day.
