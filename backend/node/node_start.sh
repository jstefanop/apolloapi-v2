#!/bin/bash
set -e

DEVICE=/dev/nvme0n1p1

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
    
    #Set zram to 1GB during IBD 
	
	sudo swapoff /dev/zram0
	sudo zramctl --size=1G /dev/zram0
	sudo mkswap /dev/zram0
	sudo swapon /dev/zram0

   #Get system RAM total
    mem_kb=$(awk '/MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null)
    if [ -z "$mem_kb" ]; then
        log "WARN: could not read MemTotal; using generic IBD profile"
        SRC_CONF="$CONF_IBD_GENERIC"
        return
    fi

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

# Check for node drive
if [ ! -b "$DEVICE" ]; then
    log "WARN: node drive not found at $DEVICE; bitcoind not started"
    exit 0
fi

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