# Shuffle API

**shuffle-api** produces shuffled orderings of a queue. Part of the
[audio-playback](/catalog/default/system/audio-playback/docs) system.

## Why not just random?

A truly random order often plays two songs by the same artist back to back,
which listeners report as "shuffle is broken". shuffle-api spreads artists and
albums evenly through the order, then adds a little jitter so the result
doesn't look mechanical.

## API

`POST /shuffle` with `{ items: [{ id, artistId, albumId }], seed }` returns
`{ order: [id, ...] }`. The same input and seed always give the same order,
so every device in a session agrees.

## Limits

- Up to 10,000 items per request.
- p95 latency under 20 ms for 500 items.
