#!/bin/bash

cd /opt/apolloapi/backend/apollo-miner
settings=$(cat miner_config)
mode=$(cat mode)

start_hashboards()
{
    while [ $1 ];
            do
            
            local boardType=$(./apollo-helper -s $1)
            
            if [[ "$boardType" == *"Apollo-BTC"* ]]; then
  				screen -dmS miner ./futurebit-miner -comport $1 -ao_mode 1 $settings -powermode $mode
			elif [[ "$boardType" == *"Apollo-2"* ]]; then
  				screen -dmS miner ./futurebit-miner-v2 -comport $1 -ao_mode 1 $settings -powermode $mode
  			else
  			    echo "unknown USB board"
  			fi
            
            sleep 1
            shift
    done
}

#clear old log files
rm apollo-miner*

#reset internal hashboard
gpio write 0 0
sleep .5
gpio write 0 1

sleep 35
#start internal hashboard

boardType=$(./apollo-helper -s /dev/ttyS1)
            
if [[ "$boardType" == *"Apollo-BTC"* ]]; then
  	screen -dmS miner ./futurebit-miner -comport /dev/ttyS1 -ao_mode 1 $settings -powermode $mode
elif [[ "$boardType" == *"Apollo-2"* ]]; then
  	screen -dmS miner ./futurebit-miner-v2 -comport /dev/ttyS1 -ao_mode 1 $settings -powermode $mode
else
  	echo "internal board error"
fi


#find and start external hashboards

ports=$(ls /dev/ttyACM*)
start_hashboards $ports

echo "Started"
