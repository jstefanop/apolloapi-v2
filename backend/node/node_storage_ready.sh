#!/bin/bash
set -Eeuo pipefail

DEVICE="${APOLLO_NODE_DEVICE:-/dev/nvme0n1p1}"
MOUNTPOINT="${APOLLO_NODE_MOUNTPOINT:-/media/nvme}"

log() { echo "[node-storage] $*" >&2; }

if [ ! -b "$DEVICE" ]; then
    log "Node storage device is not installed at $DEVICE"
    exit 1
fi

if ! findmnt -rn --mountpoint "$MOUNTPOINT" >/dev/null 2>&1; then
    log "Node storage is not mounted at $MOUNTPOINT"
    exit 1
fi

mounted_source=$(findmnt -rn -o SOURCE --mountpoint "$MOUNTPOINT")
device_path=$(readlink -f "$DEVICE" 2>/dev/null || echo "$DEVICE")
source_path=$(readlink -f "$mounted_source" 2>/dev/null || echo "$mounted_source")

if [ "$source_path" != "$device_path" ]; then
    log "$MOUNTPOINT is mounted from $mounted_source instead of $DEVICE"
    exit 1
fi

exit 0
