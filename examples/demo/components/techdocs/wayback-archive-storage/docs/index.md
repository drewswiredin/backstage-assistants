# Wayback Archive Storage

The storage subsystem of the
[wayback archive](/catalog/default/component/wayback-archive/docs). Owned by
**team-a**.

## Layout

- Snapshots are stored as WARC files in object storage, grouped by capture
  day.
- An index maps `(url, capture time)` to the WARC file and offset; lookups
  find the closest capture to a requested time in one index read.

## Retention

Captures are kept forever unless a removal request excludes the site. Removed
captures are hidden at once and deleted within 30 days.

## Capacity

About 2 PB per month of new captures. Capacity reviews happen quarterly with
the infrastructure team.
