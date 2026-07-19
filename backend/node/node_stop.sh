#!/bin/bash
set -Eeuo pipefail

MOUNTPOINT="${APOLLO_NODE_MOUNTPOINT:-/media/nvme}"
DATADIR="${APOLLO_BITCOIN_DATADIR:-${MOUNTPOINT}/Bitcoin}"
SCREEN_SESSION="${APOLLO_NODE_SCREEN_SESSION:-node}"
STOP_TIMEOUT="${APOLLO_NODE_STOP_TIMEOUT:-600}"

log() { echo "[node-stop] $*" >&2; }

find_node_pids() {
    local pid argument

    while read -r pid; do
        [ -r "/proc/${pid}/cmdline" ] || continue
        while IFS= read -r argument; do
            if [ "$argument" = "-datadir=${DATADIR}" ]; then
                printf '%s\n' "$pid"
                break
            fi
        done < <(tr '\0' '\n' < "/proc/${pid}/cmdline" 2>/dev/null || true)
    done < <(pgrep -u "$(id -u)" -x bitcoind 2>/dev/null || true)
}

if ! [[ "$STOP_TIMEOUT" =~ ^[0-9]+$ ]] || [ "$STOP_TIMEOUT" -lt 1 ]; then
    log "ERROR: APOLLO_NODE_STOP_TIMEOUT must be a positive integer"
    exit 1
fi

mapfile -t node_pids < <(find_node_pids)
if [ "${#node_pids[@]}" -eq 0 ]; then
    log "No bitcoind process found; closing any stale screen session"
    screen -S "$SCREEN_SESSION" -X quit >/dev/null 2>&1 || true
    exit 0
fi

log "Sending SIGTERM to bitcoind (${node_pids[*]})"
kill -TERM "${node_pids[@]}" 2>/dev/null || true

for ((elapsed = 0; elapsed < STOP_TIMEOUT; elapsed++)); do
    mapfile -t node_pids < <(find_node_pids)
    if [ "${#node_pids[@]}" -eq 0 ]; then
        log "bitcoind stopped cleanly after ${elapsed}s"
        screen -S "$SCREEN_SESSION" -X quit >/dev/null 2>&1 || true
        exit 0
    fi
    sleep 1
done

mapfile -t node_pids < <(find_node_pids)
log "ERROR: bitcoind is still flushing after ${STOP_TIMEOUT}s (${node_pids[*]})"
exit 1
