#!/usr/bin/env bash
# Starts the local environment: the containers, two backend replicas on :7008
# and :7009 behind the load balancer on :7007, and the frontend on :3000.
# Ctrl+C stops the replicas and the frontend; the containers keep running
# (`docker compose -f local-env/compose.yaml down` stops them).
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose -f local-env/compose.yaml up -d --wait postgres elasticsearch loadbalancer

configs=(--config ../../app-config.yaml)
[ -f app-config.local.yaml ] && configs+=(--config ../../app-config.local.yaml)
configs+=(--config ../../local-env/app-config.yaml)

replica() {
  echo "cd packages/backend && APP_CONFIG_backend_listen_port=$1 dotenv -e ../../.env -- backstage-cli package start ${configs[*]}"
}

# Replica B starts once A is ready, as in a rolling deploy: two backends
# creating fresh databases at once collide on the migration locks.
ready=localhost:7008/.backstage/health/v1/readiness
wait_for_a="until curl -fs $ready >/dev/null; do sleep 2; done"

exec concurrently --kill-others --names app,replica-a,replica-b \
  "cd packages/app && dotenv -e ../../.env -- backstage-cli package start" \
  "$(replica 7008)" \
  "$wait_for_a && $(replica 7009)"
