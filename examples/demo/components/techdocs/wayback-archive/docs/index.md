# Wayback Archive

**wayback-archive** stores snapshots of web pages over time and serves them
through the [wayback-archive API](/catalog/default/api/wayback-archive).
Owned by **team-a**.

It's split into subsystems:

| Component                                                                              | Owner  | What it does                                     |
| -------------------------------------------------------------------------------------- | ------ | ------------------------------------------------ |
| [wayback-archive-ingestion](/catalog/default/component/wayback-archive-ingestion/docs) | team-d | Crawls pages and writes snapshots                |
| [wayback-archive-storage](/catalog/default/component/wayback-archive-storage/docs)     | team-a | Stores snapshots and serves them by URL and time |
| [wayback-search](/catalog/default/component/wayback-search/docs)                       | team-a | Full-text search over the archive                |

## API

`GET /snapshots?url=&at=2019-05-01` returns the snapshot closest to the
given time. `GET /snapshots/{id}/content` returns the archived page.
