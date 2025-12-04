#!/usr/bin/env bash
#
# Rough sync check without bitcoin-cli:
# - Reads last UpdateTip line from debug.log
# - Estimates how many blocks behind tip we are (days * 144)
# - If >= BLOCK_THRESHOLD (default 100000), treat as "unsynced"
#
# Exit code:
#   0 -> "synced" (or at least not >BLOCK_THRESHOLD behind)
#   1 -> "unsynced" / "IBD-like"

# Adjust for your setup, or export DATADIR externally
DATADIR="${DATADIR:-/media/nvme/Bitcoin}"
DEBUGLOG="$DATADIR/debug.log"

# Threshold in *blocks* we consider "way behind"
BLOCK_THRESHOLD="${BLOCK_THRESHOLD:-50000}"

if [ ! -f "$DEBUGLOG" ]; then
  echo "unsynced (no debug.log yet)"
  exit 1
fi

# Last UpdateTip line
last_line=$(grep 'UpdateTip' "$DEBUGLOG" | tail -n 1 || true)

if [ -z "$last_line" ]; then
  echo "unsynced (no UpdateTip entries yet)"
  exit 1
fi

# Extract block height and block time (for logging/info)
height=$(printf '%s\n' "$last_line" | sed -n "s/.*height=\([0-9]*\).*/\1/p")
block_time_str=$(printf '%s\n' "$last_line" | sed -n "s/.*date='\([^']*\)'.*/\1/p")

if [ -z "$block_time_str" ]; then
  echo "unsynced (could not parse last block time)"
  exit 1
fi

# Convert block time to epoch, assuming format like 2025-02-03T15:29:55Z
block_ts=$(date -u -d "$block_time_str" +%s 2>/dev/null)
now_ts=$(date -u +%s)

if [ -z "$block_ts" ]; then
  echo "unsynced (date conversion failed)"
  exit 1
fi

# If node clock is behind and block time appears in the future, treat as synced
if [ "$block_ts" -gt "$now_ts" ]; then
  echo "synced (block time in the future; clock skew?) height=${height:-?}"
  exit 0
fi

diff_seconds=$(( now_ts - block_ts ))
diff_days=$(( diff_seconds / 86400 ))

# Approximate blocks behind from days * 144 blocks/day
blocks_behind_est=$(( diff_days * 144 ))

if [ "$blocks_behind_est" -ge "$BLOCK_THRESHOLD" ]; then
  echo "unsynced (est ~${blocks_behind_est} blocks behind, height=${height:-?})"
  exit 1
else
  echo "synced (est ~${blocks_behind_est} blocks behind, height=${height:-?})"
  exit 0
fi
