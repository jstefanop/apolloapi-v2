#!/bin/bash
DEVICE=/dev/nvme0n1p1
SWAPFILE=/media/nvme/swapfile

# The swapfile has to land on the node SSD, so the mount matters more than the
# block device existing: with /media/nvme unmounted this would fallocate 3G onto
# the eMMC root, and once the disk is mounted over it that space is shadowed and
# unreclaimable without unmounting again.
if ! mountpoint -q /media/nvme 2>/dev/null; then
	echo "start_swap: /media/nvme is not mounted; refusing to create a swapfile on the root filesystem" >&2
	exit 0
fi

if [ -b "$DEVICE"  ]; then
	if [ ! -f "$SWAPFILE" ]; then
		fallocate -l 3G $SWAPFILE
		chmod 600 $SWAPFILE
		mkswap $SWAPFILE
	fi
	swapon /media/nvme/swapfile
else
	exit 0
fi
