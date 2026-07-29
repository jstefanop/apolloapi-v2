#!/bin/bash

cd /opt/apolloapi/backend/apollo-miner || exit 1

ARMBIAN_RELEASE="/etc/armbian-release"
if [[ -r "$ARMBIAN_RELEASE" ]]; then
    . "$ARMBIAN_RELEASE"
fi

settings=$(<miner_config)
settings3=$(<miner_config3)

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

# miner_stop.sh resets the external boards, and a reset makes them re-enumerate:
# the tty disappears for up to ~30s, and for a while after it comes back
# apollo-helper still answers "Unknown board". A restart therefore probed an
# absent or half-awake board and skipped it, leaving the external miner down
# until the next restart — on Apollo I/II the `sleep 35` above hides this, but
# nothing does on Apollo 3 or Solo Node.
#
# Only wait when a reset actually happened: a device with no USB board must not
# pay this on every start. /run is tmpfs, so a cold boot never finds the marker —
# and after a cold boot there is nothing to wait for anyway.
USB_RESET_MARKER=/run/apollo-miner-usb-reset
EXTERNAL_WAIT_SECONDS=60

wait_for_external_hashboards()
{
    local waited=0
    local ports boardType

    while (( waited < EXTERNAL_WAIT_SECONDS )); do
        ports=(/dev/ttyACM*)
        if [[ -e ${ports[0]} ]]; then
            boardType=$(./apollo-helper -s "${ports[0]}" 2>/dev/null)
            if [[ "$boardType" == *"Apollo-BTC"* ||
                  "$boardType" == *"RD6"* ||
                  "$boardType" == *"Apollo-2"* ]]; then
                # One board answering means the bus is back; give any siblings
                # the same moment to finish enumerating.
                sleep 2
                return 0
            fi
        fi
        sleep 2
        (( waited += 2 ))
    done

    echo "external hashboards did not come back within ${EXTERNAL_WAIT_SECONDS}s"
    return 1
}

start_external_hashboards()
{
    if [[ -e "$USB_RESET_MARKER" ]]; then
        rm -f "$USB_RESET_MARKER"
        wait_for_external_hashboards
    fi

    local ports=(/dev/ttyACM*)
    if [[ -e ${ports[0]} ]]; then
        start_hashboards "${ports[@]}"
    fi
}

case "${BOARD_NAME:-}" in
    "Apollo 3")
        screen -dmS miner ./futurebit-miner-v3 $settings3
        ;;
    "Solo Node")
        ;;
    *)
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
        ;;
esac

start_external_hashboards

echo "Started"
