# Integration guide

## Install

```sh
npm install @acme/playback-sdk
```

## Play a track

```ts
import { Player } from '@acme/playback-sdk';

const player = new Player({ element: audioElement });
const next = await playbackOrder.next(sessionId); // { trackId, token, position }
await player.load(next.token, { startAt: next.position });
player.play();
```

## Events

| Event      | When                  | Payload               |
| ---------- | --------------------- | --------------------- |
| `started`  | First sample rendered | `{ ttfaMs }`          |
| `rebuffer` | Buffer ran dry        | `{ durationMs }`      |
| `ended`    | Track finished        | `{ listenedMs }`      |
| `error`    | Unrecoverable failure | `{ code, retryable }` |

## Error codes

- `TOKEN_EXPIRED`: ask playback-order for a fresh token and reload at the
  current position. Retryable.
- `DRM_UNSUPPORTED`: the device can't decrypt the stream. Not retryable; show
  the "device not supported" message.
- `NETWORK`: retried three times with backoff before it's reported.

## FAQ

**Can I preload the next track?** Yes: `player.preload(token)` fetches the
first 5 seconds so the next track starts without a gap.
