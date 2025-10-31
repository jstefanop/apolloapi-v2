#!/bin/bash
# Kill bitcoind process first
pkill -f "bitcoind.*datadir=/media/nvme/Bitcoin" 2>/dev/null || true
# Then quit screen session
screen -X -S node quit 2>/dev/null || true

