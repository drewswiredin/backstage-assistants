# Podcast

The **podcast** system serves podcast catalogs, episodes, and listening
progress. It belongs to the **playback** domain and is owned by **team-b**.

| Component                                                  | Type    | What it does                                                      |
| ---------------------------------------------------------- | ------- | ----------------------------------------------------------------- |
| [podcast-api](/catalog/default/component/podcast-api/docs) | service | Shows, episodes, and per-listener progress                        |
| [queue-proxy](/catalog/default/component/queue-proxy/docs) | website | Web front end that queues episodes and resumes where you left off |

## What makes podcasts different from music

- Episodes are long, so **resume position** matters more than ordering.
- Feeds are ingested from RSS every 15 minutes; new episodes appear within
  20 minutes of publication.
- Downloads for offline listening are allowed for every show unless the
  publisher opts out.

## Service levels

| Signal                     | Target                    |
| -------------------------- | ------------------------- |
| Episode list latency (p95) | under 250 ms              |
| Progress sync freshness    | under 5 s between devices |
| Feed ingestion delay       | under 20 minutes          |

## Contacts

- Chat: `#podcast-help`
- On call: **team-b** rotation, "Podcast primary".
