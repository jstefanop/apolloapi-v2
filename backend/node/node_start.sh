#!/bin/bash

DEVICE=/dev/nvme0n1p1

CONF_BASE="/opt/apolloapi/backend/default-configs"
NODE_DIR="/opt/apolloapi/backend/node"
CHECK_SYNC="/opt/apolloapi/backend/utils/check_node_synced.sh"

DEFAULT_CONF="${CONF_BASE}/bitcoin.conf"
IBD_GENERIC_CONF="${CONF_BASE}/bitcoin-ibd.conf"
IBD_8G_CONF="${CONF_BASE}/bitcoin-ibd-8gb.conf"
IBD_16G_CONF="${CONF_BASE}/bitcoin-ibd-16gb.conf"

BITCOIN_CONF_DST="${NODE_DIR}/bitcoin.conf"

choose_ibd_conf() {
	#Set zram to 1GB during IBD 
	
	sudo swapoff /dev/zram0
	sudo zramctl --size=1G /dev/zram0
	sudo mkswap /dev/zram0
	sudo swapon /dev/zram0

    # Read total RAM in kB
    local mem_kb
    mem_kb=$(awk '/MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null)

    # Fallback if /proc/meminfo can't be read for some reason
    if [ -z "$mem_kb" ]; then
        echo "$IBD_GENERIC_CONF"
        return
    fi

    # Rough GB (GiB) estimate, rounded to nearest GB
    # 1 GiB = 1048576 kB; add half a GiB to approximate rounding
    local mem_gb
    mem_gb=$(( (mem_kb + 524288) / 1048576 ))

    # Use +/- 1 GB buffer around 8GB and 16GB
    #  - < 7 GB       -> generic IBD
    #  - 7–9 GB       -> 8 GB IBD profile
    #  - 15–17 GB     -> 16 GB IBD profile
    #  - anything else (e.g. >17 GB) -> prefer 16 GB profile if present, else 8 GB, else generic

    if [ "$mem_gb" -lt 7 ]; then
        echo "$IBD_GENERIC_CONF"
    elif [ "$mem_gb" -ge 7 ] && [ "$mem_gb" -le 9 ]; then
        echo "$IBD_8G_CONF"
    elif [ "$mem_gb" -ge 15 ] && [ "$mem_gb" -le 17 ]; then
        echo "$IBD_16G_CONF"
    else
        # Weird sizes (e.g. 32 GB) – prefer the beefiest profile we have
        if [ -f "$IBD_16G_CONF" ]; then
            echo "$IBD_16G_CONF"
        elif [ -f "$IBD_8G_CONF" ]; then
            echo "$IBD_8G_CONF"
        else
            echo "$IBD_GENERIC_CONF"
        fi
    fi
}

if [ -b "$DEVICE" ]; then
    # Decide which bitcoin.conf to use

    # Default: assume unsynced if checker missing or fails
    SYNCED=1
    if [ -x "$CHECK_SYNC" ]; then
        "$CHECK_SYNC"
        SYNCED=$?   # 0 = synced, 1 = unsynced
    fi

    if [ "$SYNCED" -eq 0 ]; then
        # Node is roughly synced – use normal default config
        SRC_CONF="$DEFAULT_CONF"
    else
        # Node is in IBD / far behind – choose IBD profile based on RAM
        SRC_CONF="$(choose_ibd_conf)"
    fi

    # Fallback if for some reason SRC_CONF doesn't exist
    if [ ! -f "$SRC_CONF" ]; then
        # Last-resort fallback to generic IBD or default
        if [ -f "$IBD_GENERIC_CONF" ]; then
            SRC_CONF="$IBD_GENERIC_CONF"
        else
            SRC_CONF="$DEFAULT_CONF"
        fi
    fi

    # Copy chosen config into the node dir
    cp "$SRC_CONF" "$BITCOIN_CONF_DST"

    # Start bitcoind under screen with the selected config
    screen -dmS node \
        /opt/apolloapi/backend/node/bitcoind \
        -datadir=/media/nvme/Bitcoin \
        -conf="$BITCOIN_CONF_DST"
else
    exit 0
fi
