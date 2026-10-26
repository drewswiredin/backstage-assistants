# Searcher

**searcher** powers search in every ACME client: tracks, albums, artists,
playlists, and podcasts in one box. Not yet assigned to a system; questions go
to `#search-help`.

## How results are ranked

1. Text match on titles and names (typo-tolerant, language-aware).
2. Popularity over the last 28 days.
3. Personal signals: what the listener played and follows.

## API

`GET /search?q=&types=track,artist&limit=20` returns results grouped by type.
Suggestions as you type come from `GET /suggest?q=` and must answer within 50
ms.

## Index

Rebuilt nightly from the catalog and updated within a minute for new
releases.
