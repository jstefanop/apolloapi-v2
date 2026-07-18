#!/bin/bash
set -Eeuo pipefail

APOLLO_DIR="${APOLLO_DIR:-/opt/apolloapi}"
DATABASE_URL="${DATABASE_URL:-${APOLLO_DIR}/futurebit.sqlite}"

if ! enabled=$(sqlite3 "$DATABASE_URL" \
    "SELECT CASE
       WHEN COALESCE(
         (SELECT node_enable_solo_mining
            FROM settings
           ORDER BY created_at DESC, id DESC
           LIMIT 1),
         0
       ) = 1
       AND COALESCE(
         (SELECT requested_status
            FROM service_status
           WHERE service_name = 'solo'
           ORDER BY id DESC
           LIMIT 1),
         'online'
       ) != 'offline'
       THEN 1 ELSE 0
     END;" \
    2>/dev/null); then
    echo "[ckpool] Could not read solo-mining lifecycle state from $DATABASE_URL" >&2
    exit 1
fi

[ "$enabled" = "1" ]
