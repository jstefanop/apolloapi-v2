#!/bin/bash

# Binaries stay in the code checkout; the regenerated runtime data (miner_config,
# mode, apollo-miner.* stat files) lives outside it so the checkout stays clean
# for prebuilt OTA updates. The bootstrap creates RUNTIME_DIR (futurebit-owned)
# before this unit runs; mkdir -p here is only a fallback.
BIN_DIR=/opt/apolloapi/backend/apollo-miner
STATE_DIR="${APOLLO_STATE_DIR:-/var/lib/apollo}"
RUNTIME_DIR="${STATE_DIR}/miner"

mkdir -p "$RUNTIME_DIR"
cd "$RUNTIME_DIR"

settings=$(cat miner_config)
mode=$(cat mode)

start_hashboards()
{
    while [ $1 ];
            do

            local boardType=$("$BIN_DIR"/apollo-helper -s $1)

            if [[ "$boardType" == *"Apollo-BTC"* || "$boardType" == *"RD6"* ]]; then
  				screen -dmS miner "$BIN_DIR"/futurebit-miner -comport $1 -ao_mode 1 $settings -powermode $mode
			elif [[ "$boardType" == *"Apollo-2"* ]]; then
  				screen -dmS miner "$BIN_DIR"/futurebit-miner-v2 -comport $1 -ao_mode 1 $settings -powermode $mode
  			else
  			    echo "unknown USB board"
  			fi

            sleep 1
            shift
    done
}

#clear old log files
rm -f apollo-miner*

#reset internal hashboard
gpio write 0 0
sleep .5
gpio write 0 1

sleep 35
#start internal hashboard

boardType=$("$BIN_DIR"/apollo-helper -s /dev/ttyS1)

if [[ "$boardType" == *"Apollo-BTC"* || "$boardType" == *"RD6"* ]]; then
  	screen -dmS miner "$BIN_DIR"/futurebit-miner -comport /dev/ttyS1 -ao_mode 1 $settings -powermode $mode
elif [[ "$boardType" == *"Apollo-2"* ]]; then
  	screen -dmS miner "$BIN_DIR"/futurebit-miner-v2 -comport /dev/ttyS1 -ao_mode 1 $settings -powermode $mode
else
  	echo "internal board error"
fi


#find and start external hashboards

ports=$(ls /dev/ttyACM*)
start_hashboards $ports

echo "Started"
