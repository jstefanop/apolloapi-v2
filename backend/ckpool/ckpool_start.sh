#!/bin/bash
set -Eeuo pipefail

APOLLO_DIR="${APOLLO_DIR:-/opt/apolloapi}"
STATE_DIR="${APOLLO_STATE_DIR:-/var/lib/apollo}"
LOG_DIR="${APOLLO_DIR}/backend/ckpool/logs"

mkdir -p "$LOG_DIR"
rm -f "${LOG_DIR}/ckpool.log"

exec screen -D -m -S ckpool "${APOLLO_DIR}/backend/ckpool/ckpool" \
    -B \
    -c "${STATE_DIR}/ckpool.conf"
