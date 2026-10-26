# Architecture

A play request takes this path:

1. The client asks **playback-order** for the session's next item. The answer
   is a track id, a position, and a short-lived stream token.
2. When the listener has shuffle on, playback-order asks **shuffle-api** for
   an ordering of the queue once per queue change and caches it for the
   session.
3. The client hands the token to **playback-sdk**, which fetches the encrypted
   stream from the CDN, decrypts it, and starts rendering after 2 seconds of
   buffer (1 second on fast connections).

## Data

- Session state (queue, position, shuffle seed) lives in the playback-order
  Redis cluster, keyed by session id, with a 24 hour TTL.
- Play events are written to the `playback.events.v3` topic. Downstream
  consumers include royalties reporting and recommendations; the schema is
  owned by team-c and changes go through the schema review channel.

## Failure modes

| Failure           | Effect                                                 | Mitigation                                |
| ----------------- | ------------------------------------------------------ | ----------------------------------------- |
| shuffle-api down  | Shuffle falls back to a client-side Fisher–Yates order | Automatic; alert after 5 minutes          |
| Redis failover    | Sessions lose position for up to 30 s                  | Clients resend their last position        |
| CDN region outage | Higher time to first audio                             | Traffic shifts to the next nearest region |

## Decisions

- Ordering is server-side so that every device in a session agrees on what
  plays next.
- Stream tokens expire after 10 minutes so leaked URLs stop working quickly.
