#!/bin/bash
#
# Emits four UI-facing env vars to the Next.js .env file, used by
# DeviceConfigContext to drive nav / settings UI for the 5 device states
# (Solo Node, Solo Node + Miner UI, Apollo II, Apollo III, Apollo III + USB).
#
#   NEXT_PUBLIC_CHASSIS         solo-node | apollo-ii | apollo-iii
#   NEXT_PUBLIC_INTERNAL_MINER  none | apollo-iii
#   NEXT_PUBLIC_USB_MINERS      none | apollo-i | apollo-ii | apollo-i,apollo-ii
#   NEXT_PUBLIC_DEVICE_TYPE     solo-node | (unset)  — legacy, derived
#
# Overrides for development / forced state:
#   APOLLO_CHASSIS_FORCE        forces chassis value (skips detection)
#   APOLLO_III_FORCE=1          forces internalMiner=apollo-iii
#
# TBD: John — concrete detection for "Apollo III internal hardware present".
# Today the only stable hint is the sentinel file /etc/apolloapi/apollo-iii
# (or the APOLLO_III_FORCE env). Replace with the real probe when available.

ENV_FILE="/opt/apolloapi/apolloui-v2/.env"
CHASSIS_SENTINEL="/etc/apolloapi/chassis"
APOLLO_III_SENTINEL="/etc/apolloapi/apollo-iii"

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

# --- USB enumeration (no break — collect every board type present) ---
USB_PORTS=(/dev/ttyACM*)
if [[ ! -e ${USB_PORTS[0]} ]]; then
    USB_PORTS=()
fi

declare -A USB_TYPES

for port in "${USB_PORTS[@]}"; do
    echo "Checking $port"
    boardType=$(/opt/apolloapi/backend/apollo-miner/apollo-helper -s "$port" 2>/dev/null)
    if [[ "$boardType" == *"Apollo-BTC"* || "$boardType" == *"RD6"* ]]; then
        USB_TYPES["apollo-i"]=1
    elif [[ "$boardType" == *"Apollo-2"* ]]; then
        USB_TYPES["apollo-ii"]=1
    fi
done

USB_LIST=""
for key in "apollo-i" "apollo-ii"; do
    if [[ -n "${USB_TYPES[$key]:-}" ]]; then
        USB_LIST="${USB_LIST:+$USB_LIST,}$key"
    fi
done
USB_MINERS="${USB_LIST:-none}"

# --- Internal Apollo III detection (stub) ---
if [[ "${APOLLO_III_FORCE:-}" == "1" ]] || [[ -e "$APOLLO_III_SENTINEL" ]]; then
    INTERNAL_MINER="apollo-iii"
else
    INTERNAL_MINER="none"
fi

# --- Chassis detection ---
# Priority: env override > sentinel file > inferred from miners present.
if [[ -n "${APOLLO_CHASSIS_FORCE:-}" ]]; then
    CHASSIS="$APOLLO_CHASSIS_FORCE"
elif [[ -r "$CHASSIS_SENTINEL" ]]; then
    CHASSIS=$(tr -d '[:space:]' < "$CHASSIS_SENTINEL")
elif [[ "$INTERNAL_MINER" == "apollo-iii" ]]; then
    CHASSIS="apollo-iii"
elif [[ "$USB_MINERS" != "none" ]]; then
    CHASSIS="apollo-ii"
else
    CHASSIS="solo-node"
fi

echo "Detected: chassis=$CHASSIS internalMiner=$INTERNAL_MINER usbMiners=$USB_MINERS"

set_env_var "NEXT_PUBLIC_CHASSIS" "$CHASSIS"
set_env_var "NEXT_PUBLIC_INTERNAL_MINER" "$INTERNAL_MINER"
set_env_var "NEXT_PUBLIC_USB_MINERS" "$USB_MINERS"

# Legacy flag — keep present only when the chassis is solo-node AND no miner UI
# is needed (no USB units). Drop it in every other state so the UI falls back
# to the new orthogonal flags.
if [[ "$CHASSIS" == "solo-node" && "$USB_MINERS" == "none" ]]; then
    set_env_var "NEXT_PUBLIC_DEVICE_TYPE" "solo-node"
else
    remove_env_var "NEXT_PUBLIC_DEVICE_TYPE"
fi

echo "Done."
