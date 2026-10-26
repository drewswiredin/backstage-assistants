# Podcast API

**podcast-api** serves podcast shows and episodes and keeps each listener's
progress. Part of the [podcast](/catalog/default/system/podcast/docs) system,
owned by **team-b**.

## Endpoints

| Endpoint                           | What it does                               |
| ---------------------------------- | ------------------------------------------ |
| `GET /shows/{id}`                  | Show details                               |
| `GET /shows/{id}/episodes?cursor=` | Episodes, newest first, 50 per page        |
| `GET /me/progress/{episodeId}`     | The listener's position                    |
| `PUT /me/progress/{episodeId}`     | Report a position (`{ positionMs, seek }`) |

## Progress rules

The furthest position wins unless the client sends `seek: true`, so two
devices never fight. Positions within 30 seconds of the end mark the episode
as finished.

## Feeds

A worker in the same service ingests RSS feeds every 15 minutes. See the
[podcast architecture](/catalog/default/system/podcast/docs/architecture/)
for how unhealthy feeds are handled.
