#!/bin/bash
cd /opt/apolloapi/backend/apollo-miner


reset_hashboards()
{
    while [ $1 ];
            do
            ./apollo-helper -s $1 -r
            sleep .5
            shift
    done
}

#quit all mining proccesses
screen -ls | grep '\.miner' | awk -F '\t|[.]' '{print $2}' | while read -r session
do
  echo "Killing session: $session"
  screen -S "${session}" -X quit
done

#reset internal hashboard
gpio write 0 0
sleep .5
gpio write 0 1

#find and reset external hashboards

ports=$(ls /dev/ttyACM*)
reset_hashboards $ports

echo "Stopped"
