#!/bin/bash
DEVICE=/dev/nvme0n1p1

if [ -b "$DEVICE"  ]; then
        swapon /media/nvme/swapfile
else
        exit 0
fi
