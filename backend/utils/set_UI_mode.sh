#!/bin/bash

ENV_FILE="/opt/apolloapi/apolloui-v2/.env"
KEY="NEXT_PUBLIC_DEVICE_TYPE"
VALUE="solo-node"

# Add or update environment variable 
set_env_var() {
    local key="$1"
    local value="$2"

    # If key exists, update it
    if grep -q "^${key}=" "$ENV_FILE"; then
        sed -i "s|^${key}=.*|${key}=\"${value}\"|" "$ENV_FILE"
    else
        echo "${key}=\"${value}\"" >> "$ENV_FILE"
    fi
}

# Remove variable entirely
remove_env_var() {
    local key="$1"
    sed -i "/^${key}=/d" "$ENV_FILE"
}

# Detect USB hashboards
USB_PORTS=(/dev/ttyACM*)

VALID_BOARD_FOUND=0

# If no ACM ports exist, fix array to be empty
if [[ ! -e ${USB_PORTS[0]} ]]; then
    USB_PORTS=()
fi

for port in "${USB_PORTS[@]}"; do
    echo "Checking $port"
    boardType=$(/opt/apolloapi/backend/apollo-miner/apollo-helper -s "$port" 2>/dev/null)

    if [[ "$boardType" == *"Apollo-BTC"* || \
          "$boardType" == *"RD6"* || \
          "$boardType" == *"Apollo-2"* ]]; then
        VALID_BOARD_FOUND=1
        break
    fi
done

# Update or remove .env variable
if [[ $VALID_BOARD_FOUND -eq 1 ]]; then
    echo "USB hashboard detected → removing $KEY"
    remove_env_var "$KEY"
else
    echo "No USB hashboards detected → setting $KEY=\"$VALUE\""
    set_env_var "$KEY" "$VALUE"
fi

echo "Done."
