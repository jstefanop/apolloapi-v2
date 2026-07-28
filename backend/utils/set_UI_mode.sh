#!/bin/bash

ENV_FILE="/opt/apolloapi/apolloui-v2/.env"
ARMBIAN_RELEASE="/etc/armbian-release"

if [[ -r "$ARMBIAN_RELEASE" ]]; then
    . "$ARMBIAN_RELEASE"
fi

set_env_var() {
    local key="$1"
    local value="$2"
    if grep -q "^${key}=" "$ENV_FILE"; then
        sed -i "s|^${key}=.*|${key}=\"${value}\"|" "$ENV_FILE"
    else
        echo "${key}=\"${value}\"" >> "$ENV_FILE"
    fi
}

remove_env_var() {
    local key="$1"
    sed -i "/^${key}=/d" "$ENV_FILE"
}

case "${BOARD_NAME:-}" in
    "Apollo 3")
        set_env_var "NEXT_PUBLIC_CHASSIS" "apollo-iii"
        remove_env_var "NEXT_PUBLIC_USB_MINERS"
        echo "Detected Apollo III chassis"
        ;;
    "Solo Node")
        set_env_var "NEXT_PUBLIC_CHASSIS" "solo-node"

        USB_MINER_FOUND=0
        USB_PORTS=(/dev/ttyACM*)
        if [[ ! -e ${USB_PORTS[0]} ]]; then
            USB_PORTS=()
        fi

        for port in "${USB_PORTS[@]}"; do
            echo "Checking $port"
            boardType=$(/opt/apolloapi/backend/apollo-miner/apollo-helper -s "$port" 2>/dev/null)
            if [[ "$boardType" == *"Apollo-BTC"* ||
                  "$boardType" == *"RD6"* ||
                  "$boardType" == *"Apollo-2"* ]]; then
                USB_MINER_FOUND=1
                break
            fi
        done

        if [[ "$USB_MINER_FOUND" -eq 1 ]]; then
            set_env_var "NEXT_PUBLIC_USB_MINERS" "true"
            echo "Detected Solo Node chassis with USB miner"
        else
            remove_env_var "NEXT_PUBLIC_USB_MINERS"
            echo "Detected Solo Node chassis without USB miner"
        fi
        ;;
    *)
        echo "Unsupported BOARD_NAME: ${BOARD_NAME:-unset}" >&2
        exit 1
        ;;
esac

echo "Done."
