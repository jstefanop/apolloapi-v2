#!/bin/bash

#quit all mining proccesses
for scr in $(screen -ls | awk '{print $1}'); do screen -S $scr -X quit; done

#reset internal hashboard
gpio write 0 0
sleep .5
gpio write 0 1

echo "Stopped"
