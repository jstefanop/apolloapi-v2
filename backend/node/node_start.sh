#!/bin/bash

DEVICE=/dev/nvme0n1p1

if [ -b "$DEVICE"  ]; then
        screen -dmS node /opt/apolloapi/backend/node/bitcoind -datadir=/media/nvme/Bitcoin -conf=/opt/apolloapi/backend/node/bitcoin.conf
else
        exit 0
fi

