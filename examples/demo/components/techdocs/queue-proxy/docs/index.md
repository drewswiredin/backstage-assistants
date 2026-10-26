# Queue Proxy

**queue-proxy** is the podcast web experience: browse shows, queue episodes,
and resume where you left off on any device. Part of the
[podcast](/catalog/default/system/podcast/docs) system, owned by **team-b**.

## How it works

- A Next.js site that renders show and episode pages on the server for fast
  first paint and search engines.
- Reads from [podcast-api](/catalog/default/component/podcast-api/docs) and
  reports progress back every 10 seconds.
- Keeps the listener's queue in podcast-api, so it follows them to the apps.

## Releases

Every weekday at 14:00 UTC. Feature flags gate anything risky; flags live in
the flags service under the `queue-proxy.` prefix.
