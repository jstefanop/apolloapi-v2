#!/bin/bash

reset_hashboards()
{
    while [ $1 ];
            do
            python -c 'import termios; termios.tcsendbreak(3, 0)' 3>$1
            sleep .5
            shift
    done
}

#quit all mining proccesses
for scr in $(screen -ls | awk '{print $1}'); do screen -S $scr -X quit; done

#reset internal hashboard
gpio write 0 0
sleep .5
gpio write 0 1

#find and reset external hashboards

ports=$(ls /dev/ttyACM*)
reset_hashboards $ports

echo "Stopped"
