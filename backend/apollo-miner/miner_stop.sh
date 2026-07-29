#!/bin/bash

cd /opt/apolloapi/backend/apollo-miner || exit 1

ARMBIAN_RELEASE="/etc/armbian-release"
if [[ -r "$ARMBIAN_RELEASE" ]]; then
    . "$ARMBIAN_RELEASE"
fi

reset_hashboards()
{
    while [[ -n "${1:-}" ]]; do
        ./apollo-helper -s "$1" -r
        sleep .5
        shift
    done
}

reset_external_hashboards()
{
    local ports=(/dev/ttyACM*)
    if [[ -e ${ports[0]} ]]; then
        reset_hashboards "${ports[@]}"
    fi
}

# Quit all mining processes.
screen -ls | grep '\.miner' | awk -F '\t|[.]' '{print $2}' | while read -r session
do
    echo "Killing session: $session"
    screen -S "$session" -X quit
done

case "${BOARD_NAME:-}" in
    "Apollo 3"|"Solo Node")
        ;;
    *)
        # Reset the internal hashboard.
        gpio write 0 0
        sleep .5
        gpio write 0 1
        ;;
esac

# Find and reset external hashboards.
reset_external_hashboards

echo "Stopped"
