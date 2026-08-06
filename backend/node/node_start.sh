#!/bin/bash
set -e

DEVICE=/dev/nvme0n1p1
MOUNTPOINT=/media/nvme

CONF_BASE="/opt/apolloapi/backend/default-configs"
NODE_DIR="/opt/apolloapi/backend/node"
CHECK_SYNC="/opt/apolloapi/backend/utils/check_node_synced.sh"

# Source config files
CONF_SYNCED="${CONF_BASE}/bitcoin.conf"
CONF_IBD_GENERIC="${CONF_BASE}/bitcoin-ibd.conf"
CONF_IBD_8G="${CONF_BASE}/bitcoin-ibd-8gb.conf"
CONF_IBD_16G="${CONF_BASE}/bitcoin-ibd-16gb.conf"

# Destination config
CONF_DST="${NODE_DIR}/bitcoin.conf"

# Default selection
SRC_CONF="$CONF_SYNCED"

log() { echo "[node-start] $*" >&2; }

set_conf_by_ram_for_ibd() {
    local mem_kb mem_gb

    # Shrink zram to 1GB during IBD, to leave more RAM for bitcoind's cache.
    #
    # Best effort, and deliberately so: newer Armbian manages zram through
    # armbian-zram-config, which holds the device and refuses the resize. Under
    # `set -e` that failure used to abort this script entirely, so a memory
    # optimisation stopped the node from starting at all.
    if ! (sudo swapoff /dev/zram0 &&
          sudo zramctl --size=1G /dev/zram0 &&
          sudo mkswap /dev/zram0 &&
          sudo swapon /dev/zram0) 2>/dev/null; then
        log "WARN: could not resize zram for IBD (managed elsewhere?)"

        # Recovery matters more than the resize did. Failing halfway can leave the
        # device with no swap at all, and bitcoind doing an IBD on a board with
        # neither swap nor spare RAM is killed by the OOM reaper on repeat — a far
        # worse outcome than simply not shrinking zram. Rebuild the signature if
        # the resize destroyed it, then check we actually have swap back.
        sudo swapon /dev/zram0 2>/dev/null ||
            (sudo mkswap /dev/zram0 >/dev/null 2>&1 && sudo swapon /dev/zram0 2>/dev/null) ||
            true

        if ! grep -q "^/dev/zram0" /proc/swaps 2>/dev/null &&
           ! grep -qE "^(/|[^ ]+swapfile)" /proc/swaps 2>/dev/null; then
            log "ERROR: no swap is active; bitcoind may be OOM-killed during IBD"
        fi
    fi
	
	#Get system RAM total
    # Suppress low-level awk noise; we log our own warning if it fails
    mem_kb=$(awk '/MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null)
    if [ -z "$mem_kb" ]; then
        log "WARN: could not read MemTotal; using generic IBD profile"
        SRC_CONF="$CONF_IBD_GENERIC"
        return
    fi

    # Convert to GiB, rounded to nearest integer
    mem_gb=$(( (mem_kb + 524288) / 1048576 ))
    log "Detected RAM: ${mem_gb}GiB (MemTotal=${mem_kb}kB)"

    # <7 GiB   -> generic
    # 7–15 GiB -> 8GB
    # >15 GiB  -> 16GB
    if [ "$mem_gb" -lt 7 ]; then
        SRC_CONF="$CONF_IBD_GENERIC"
    elif [ "$mem_gb" -le 15 ]; then
        SRC_CONF="$CONF_IBD_8G"
    else
        SRC_CONF="$CONF_IBD_16G"
    fi
}

# --- Node drive / mount validation ---
# The same check the API reports to the UI, so a node that will not start and a
# panel explaining why can never disagree. Some Apollo III ship with no SSD at
# all; the states below are what the user is told, and what they can act on.
NODE_PARTITION="$DEVICE"
NODE_MOUNTPOINT="$MOUNTPOINT"
. /opt/apolloapi/backend/lib/node_storage.sh

storage_state="$(node_storage_state)"
if [ "$storage_state" != "ready" ]; then
    case "$storage_state" in
        no-drive)    log "WARN: no node drive detected; bitcoind not started" ;;
        unformatted) log "WARN: node drive present but not formatted; bitcoind not started" ;;
        not-mounted) log "WARN: $MOUNTPOINT is not mounted; bitcoind not started" ;;
        foreign)     log "WARN: $MOUNTPOINT is mounted from something other than the node drive; bitcoind not started" ;;
    esac
    exit 0
fi

log "Node storage OK: $MOUNTPOINT mounted from $NODE_PARTITION"
# --- end validation ---

# Determine sync state (default unsynced)
synced=1
if [ -x "$CHECK_SYNC" ]; then
    if "$CHECK_SYNC"; then
        synced=0
    else
        synced=1
    fi
else
    log "WARN: sync checker not executable: $CHECK_SYNC; assuming unsynced"
fi

if [ "$synced" -eq 0 ]; then
    SRC_CONF="$CONF_SYNCED"
    log "State=synced -> selecting $(basename "$SRC_CONF")"
else
    set_conf_by_ram_for_ibd
    log "State=unsynced -> selecting $(basename "$SRC_CONF")"
fi

# Copy chosen config (log failure but never block startup)
if ! cp -f "$SRC_CONF" "$CONF_DST"; then
    log "WARN: failed to copy $(basename "$SRC_CONF"); using existing bitcoin.conf"
fi

# Start bitcoind
screen -dmS node \
    /opt/apolloapi/backend/node/bitcoind \
    -datadir=/media/nvme/Bitcoin \
    -conf="$CONF_DST"