#!/bin/bash
set -Eeuo pipefail

DEVICE="${APOLLO_NODE_DEVICE:-/dev/nvme0n1p1}"
MOUNTPOINT="${APOLLO_NODE_MOUNTPOINT:-/media/nvme}"
DATADIR="${APOLLO_BITCOIN_DATADIR:-${MOUNTPOINT}/Bitcoin}"
APOLLO_DIR="${APOLLO_DIR:-/opt/apolloapi}"
STATE_DIR="${APOLLO_STATE_DIR:-/var/lib/apollo}"
DATABASE_URL="${DATABASE_URL:-${APOLLO_DIR}/futurebit.sqlite}"

CONF_BASE="${APOLLO_DIR}/backend/default-configs"
CONF_DST="${STATE_DIR}/bitcoin.conf"
CHECK_SYNC="${APOLLO_DIR}/backend/utils/check_node_synced.sh"

CONF_SYNCED="${CONF_BASE}/bitcoin.conf"
CONF_IBD_GENERIC="${CONF_BASE}/bitcoin-ibd.conf"
CONF_IBD_8G="${CONF_BASE}/bitcoin-ibd-8gb.conf"
CONF_IBD_16G="${CONF_BASE}/bitcoin-ibd-16gb.conf"
SRC_CONF="$CONF_SYNCED"

log() { echo "[node-start] $*" >&2; }

set_conf_by_ram_for_ibd() {
    local mem_kb mem_gb

    # ZRAM tuning is an optimization, not a condition for starting bitcoind.
    if [ -b /dev/zram0 ]; then
        sudo swapoff /dev/zram0 >/dev/null 2>&1 || true
        sudo zramctl --reset /dev/zram0 >/dev/null 2>&1 || true
        if ! sudo zramctl --size=1G /dev/zram0 >/dev/null 2>&1 ||
           ! sudo mkswap /dev/zram0 >/dev/null 2>&1 ||
           ! sudo swapon /dev/zram0 >/dev/null 2>&1; then
            log "WARN: could not configure IBD ZRAM"
        fi
    fi

    mem_kb=$(awk '/MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || true)
    if [ -z "$mem_kb" ]; then
        log "WARN: could not read MemTotal; using generic IBD profile"
        SRC_CONF="$CONF_IBD_GENERIC"
        return
    fi

    mem_gb=$(( (mem_kb + 524288) / 1048576 ))
    log "Detected RAM: ${mem_gb}GiB (MemTotal=${mem_kb}kB)"
    if [ "$mem_gb" -lt 7 ]; then
        SRC_CONF="$CONF_IBD_GENERIC"
    elif [ "$mem_gb" -le 15 ]; then
        SRC_CONF="$CONF_IBD_8G"
    else
        SRC_CONF="$CONF_IBD_16G"
    fi
}

select_bitcoind() {
    local software arch
    if ! software=$(sqlite3 "$DATABASE_URL" \
        "SELECT node_software FROM settings ORDER BY created_at DESC, id DESC LIMIT 1;" \
        2>/dev/null); then
        log "ERROR: could not read node software from $DATABASE_URL"
        return 1
    fi
    if [ -z "$software" ]; then
        log "ERROR: no node software is configured"
        return 1
    fi
    arch=$(uname -m)

    case "$software" in
        core-25.1|core-28.1|core-29.2|core-31.0|knots-29.2|knots-29.3)
            ;;
        *)
            log "ERROR: unsupported node software '$software'"
            return 1
            ;;
    esac

    BITCOIND="${APOLLO_DIR}/backend/node/bin/${software}/${arch}/bitcoind"
    if [ ! -x "$BITCOIND" ]; then
        log "ERROR: executable not found for ${software}/${arch}: $BITCOIND"
        return 1
    fi
    log "Selected ${software}/${arch}"
}

if [ ! -b "$DEVICE" ]; then
    log "ERROR: node drive device not found at $DEVICE"
    exit 1
fi

if ! findmnt -rn --mountpoint "$MOUNTPOINT" >/dev/null 2>&1; then
    log "ERROR: $MOUNTPOINT is not mounted"
    exit 1
fi

mnt_src="$(findmnt -rn -o SOURCE --mountpoint "$MOUNTPOINT" 2>/dev/null || true)"
dev_real="$(readlink -f "$DEVICE" 2>/dev/null || echo "$DEVICE")"
src_real="$(readlink -f "$mnt_src" 2>/dev/null || echo "$mnt_src")"
if [ -z "$mnt_src" ] || [ "$src_real" != "$dev_real" ]; then
    log "ERROR: $MOUNTPOINT mounted from '$mnt_src' (expected '$DEVICE')"
    exit 1
fi
log "Node storage OK: $MOUNTPOINT mounted from $mnt_src"

if [ -x "$CHECK_SYNC" ] && "$CHECK_SYNC"; then
    SRC_CONF="$CONF_SYNCED"
    log "State=synced -> selecting $(basename "$SRC_CONF")"
else
    set_conf_by_ram_for_ibd
    log "State=unsynced -> selecting $(basename "$SRC_CONF")"
fi

select_bitcoind
mkdir -p "$STATE_DIR"
while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
        includeconf=/var/lib/apollo/*)
            printf 'includeconf=%s/%s\n' "$STATE_DIR" "${line##*/}"
            ;;
        *)
            printf '%s\n' "$line"
            ;;
    esac
done < "$SRC_CONF" > "${CONF_DST}.tmp"
chmod 600 "${CONF_DST}.tmp"
mv -f "${CONF_DST}.tmp" "$CONF_DST"

log "Starting bitcoind in attachable screen session 'node'"
exec screen -D -m -S node "$BITCOIND" \
    -datadir="$DATADIR" \
    -conf="$CONF_DST"
