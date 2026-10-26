# Operations

## Configuration

| Variable            | Default | Meaning                                            |
| ------------------- | ------- | -------------------------------------------------- |
| `SHUFFLE_MAX_ITEMS` | `10000` | Requests above this get a 413                      |
| `SHUFFLE_JITTER`    | `0.15`  | How far items may move from the evenly spread slot |

## Failure behavior

shuffle-api is stateless. When it's down, playback-order falls back to a
client-side order, so listeners still get shuffle, just a less even one. Treat
an outage as degraded, not down.

## Load testing

The `load/` folder in the repository holds a k6 script that replays a day of
production request sizes. Run it against staging before changing the
algorithm.
