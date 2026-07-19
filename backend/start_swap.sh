#!/bin/bash
set -Eeuo pipefail

MOUNTPOINT="${APOLLO_NODE_MOUNTPOINT:-/media/nvme}"
SWAPFILE="${MOUNTPOINT}/swapfile"

findmnt -rn --mountpoint "$MOUNTPOINT" >/dev/null
[ -f "$SWAPFILE" ]

if ! swapon --show=NAME --noheadings | awk '{$1=$1};1' | grep -Fxq "$SWAPFILE"; then
    swapon "$SWAPFILE"
fi
