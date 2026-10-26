# Playback Order

**playback-order** answers one question for every session: what plays next?
Part of the [audio-playback](/catalog/default/system/audio-playback/docs)
system. A Java service.

## API

| Endpoint                      | What it does                                            |
| ----------------------------- | ------------------------------------------------------- |
| `POST /sessions/{id}/next`    | Returns the next item, its position, and a stream token |
| `PUT /sessions/{id}/queue`    | Replaces the queue                                      |
| `POST /sessions/{id}/shuffle` | Turns shuffle on or off                                 |

Tokens expire after 10 minutes. Responses are under 30 ms at p95.

## Dependencies

- **Redis** for session state (24 hour TTL).
- **shuffle-api** when shuffle is on; on failure the service falls back to a
  client-side order and logs `shuffle_fallback`.

## Ownership

The catalog lists the owner as `user:guest` while the service moves from the
old platform team to **team-c**; questions go to `#playback-help`.
