# Audio Playback

The **audio-playback** system is everything between a listener pressing play
and sound coming out of their device. It belongs to the **playback** domain
and is owned by **team-c**.

| Component                                                        | Type    | What it does                                                  |
| ---------------------------------------------------------------- | ------- | ------------------------------------------------------------- |
| [playback-sdk](/catalog/default/component/playback-sdk/docs)     | library | Decodes, buffers, and renders audio and video on every client |
| [playback-order](/catalog/default/component/playback-order/docs) | service | Decides what plays next for a session                         |
| [shuffle-api](/catalog/default/component/shuffle-api/docs)       | service | Produces shuffled orderings that feel random to people        |

## Service levels

| Signal                    | Target                                            |
| ------------------------- | ------------------------------------------------- |
| Time to first audio (p95) | under 400 ms on broadband, under 900 ms on mobile |
| Playback start success    | 99.95% per day                                    |
| Rebuffer ratio            | under 0.4% of listening time                      |

Playback start success is the system's headline SLO. An incident is declared
when it drops below 99.9% for 10 minutes in any region.

## Getting help

- Chat: `#playback-help` for questions, `#playback-incidents` during an incident.
- On call: the **team-c** rotation in the paging tool, "Playback primary".
- Office hours: Thursdays 15:00 UTC.
