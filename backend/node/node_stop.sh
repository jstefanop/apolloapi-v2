#!/bin/bash
set -e

DATADIR="/media/nvme/Bitcoin"
PATTERN="bitcoind.*datadir=$DATADIR"
TIMEOUT=600   # seconds to wait (10 minutes)

# Ask bitcoind to exit cleanly via SIGTERM
pkill -TERM -f "$PATTERN" 2>/dev/null || true

# Make sure bitcoind exits cleanly during heavy dbcache flushes
for ((i=0; i<TIMEOUT; i++)); do
    if ! pgrep -f "$PATTERN" >/dev/null 2>&1; then
        # bitcoind is gone
        break
    fi
    sleep 1
done

screen -X -S node quit 2>/dev/null || true

exit 0

