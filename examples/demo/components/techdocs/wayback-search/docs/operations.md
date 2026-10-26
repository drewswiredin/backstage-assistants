# Operations

## Index updates

A daily job reads the previous day's captures through the wayback-archive API
and indexes their text. If the job fails, the next run catches up; two
failures in a row page team-a.

## Ranking

Results are ranked by text relevance, then by how often the page was linked
at capture time. There's no personalization.

## Quotas

Anonymous API callers get 60 queries per minute; registered clients get 600.
