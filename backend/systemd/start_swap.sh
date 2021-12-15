#!/bin/bash
DEVICE=/dev/nvme0n1p1
SWAPFILE=/media/nvme/swapfile

if [ -b "$DEVICE"  ]; then
	if [ ! -f "$SWAPFILE" ]; then
		fallocate -l 2G $SWAPFILE
		chmod 600 $SWAPFILE
		mkswap $SWAPFILE
	fi
	swapon /media/nvme/swapfile
else
	exit 0
fi
