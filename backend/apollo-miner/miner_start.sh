#!/bin/bash

cd /opt/apolloapi/backend/apollo-miner || exit 1

ARMBIAN_RELEASE="/etc/armbian-release"
if [[ -r "$ARMBIAN_RELEASE" ]]; then
    . "$ARMBIAN_RELEASE"
fi

start_hashboards()
{
    while [[ -n "${1:-}" ]]; do
        local port="$1"
        local boardType
        boardType=$(./apollo-helper -s "$port")

        if [[ "$boardType" == *"Apollo-BTC"* || "$boardType" == *"RD6"* ]]; then
            screen -dmS miner ./futurebit-miner -comport "$port" -ao_mode 1 $settings
        elif [[ "$boardType" == *"Apollo-2"* ]]; then
            screen -dmS miner ./futurebit-miner-v2 -comport "$port" -ao_mode 1 $settings
        else
            echo "unknown USB board"
        fi

        sleep 1
        shift
    done
}

start_external_hashboards()
{
    local ports=(/dev/ttyACM*)
    if [[ -e ${ports[0]} ]]; then
        start_hashboards "${ports[@]}"
    fi
}

case "${BOARD_NAME:-}" in
    "Apollo 3")
        settings3=$(<miner_config3)
        screen -dmS miner ./futurebit-miner-v3 $settings3
        ;;
    "Solo Node")
        settings=$(<miner_config)
        start_external_hashboards
        ;;
    *)
        settings=$(<miner_config)

        # Clear old log files.
        rm apollo-miner*

        # Reset the internal hashboard.
        gpio write 0 0
        sleep .5
        gpio write 0 1

        sleep 35

        # Start the internal hashboard.
        boardType=$(./apollo-helper -s /dev/ttyS1)

        if [[ "$boardType" == *"Apollo-BTC"* || "$boardType" == *"RD6"* ]]; then
            screen -dmS miner ./futurebit-miner -comport /dev/ttyS1 -ao_mode 1 $settings
        elif [[ "$boardType" == *"Apollo-2"* ]]; then
            screen -dmS miner ./futurebit-miner-v2 -comport /dev/ttyS1 -ao_mode 1 $settings
        else
            echo "internal board error"
        fi

        start_external_hashboards
        ;;
esac

echo "Started"
