# Playback SDK

**playback-sdk** is the library that turns a stream token into sound and
pictures. Every ACME client (web, iOS, Android, desktop, TV) embeds it. Part
of the [audio-playback](/catalog/default/system/audio-playback/docs) system,
owned by **team-c**.

## What it does

- Fetches encrypted segments from the CDN and decrypts them on the device.
- Picks a bitrate from measured bandwidth (three audio tiers: 96, 160, and
  320 kbps).
- Buffers 2 seconds before starting (1 second on fast connections) and keeps
  up to 60 seconds ahead.
- Reports play, pause, seek, and rebuffer events to `playback.events.v3`.

## Supported platforms

| Platform | Minimum version                                 | Package                       |
| -------- | ----------------------------------------------- | ----------------------------- |
| Web      | evergreen browsers with Media Source Extensions | `@acme/playback-sdk`          |
| iOS      | 15                                              | `PlaybackSDK` (Swift Package) |
| Android  | API 26                                          | `com.acme:playback-sdk`       |

## Versioning

Semantic versioning. Minor releases every two weeks; clients must stay within
two minor versions of the latest, because older versions stop receiving new
stream formats.
