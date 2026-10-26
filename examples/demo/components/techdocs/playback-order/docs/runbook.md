# Runbook

## Alert: playback-order 5xx rate above 1%

1. Check the deploy log: a deploy in the last 30 minutes is the usual cause.
   Roll back with the pipeline's "Rollback" button.
2. Check Redis health. A failover shows as a short spike of
   `SESSION_NOT_FOUND`; it clears on its own within a minute.
3. If shuffle-api is failing, the error rate stays low (fallback), but
   `shuffle_fallback` climbs. Page team-c's shuffle owner.

## Alert: token issue latency above 100 ms

The token signer runs on a key fetched at startup. Latency climbs when the
key cache is cold after a restart wave; it settles within five minutes. If it
doesn't, restart the pods one at a time.

## Useful queries

- Errors by code: `service:playback-order status:error | count by code`
- Sessions per minute: `metric:playback_order.sessions.active`

## Escalation

team-c primary, then the playback domain lead (frank.tiernan).
