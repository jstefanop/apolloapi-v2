#!/bin/bash

# Bitcoin Software Switcher
# Safely switches between Bitcoin Core and Bitcoin Knots

YELLOW='\033[1;33m'
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

APOLLO_DIR=/opt/apolloapi
TARGET_SOFTWARE=$1

# Check if target software is specified
if [ -z "$TARGET_SOFTWARE" ]; then
    echo -e "${RED}Usage: $0 <core-latest|knots-latest>${NC}"
    exit 1
fi

# Validate target software
if [[ "$TARGET_SOFTWARE" != "core-latest" && "$TARGET_SOFTWARE" != "knots-latest" ]]; then
    echo -e "${RED}Invalid software: $TARGET_SOFTWARE${NC}"
    echo -e "${RED}Valid options: core-latest, knots-latest${NC}"
    exit 1
fi

echo -e "${YELLOW} ---> Switching Bitcoin software to $TARGET_SOFTWARE${NC}"

# Get current architecture
arch=$(uname -m)

# Check if target binary exists
if [[ "$TARGET_SOFTWARE" == "knots-latest" ]]; then
    SOURCE_BINARY="$APOLLO_DIR/backend/node/bin/knots/$arch/bitcoind"
else
    SOURCE_BINARY="$APOLLO_DIR/backend/node/bin/core/$arch/bitcoind"
fi

if [ ! -f "$SOURCE_BINARY" ]; then
    echo -e "${RED}Error: Source binary not found: $SOURCE_BINARY${NC}"
    exit 1
fi

# Stop node service if running
if systemctl is-active --quiet node.service; then
    echo -e "${YELLOW} ---> Stopping node service${NC}"
    systemctl stop node.service
    
    # Wait a bit for the service to fully stop
    sleep 2
    
    # Check if service is actually stopped
    if systemctl is-active --quiet node.service; then
        echo -e "${RED}Error: Failed to stop node service${NC}"
        exit 1
    fi
    echo -e "${GREEN} ---> Node service stopped successfully${NC}"
else
    echo -e "${YELLOW} ---> Node service was not running${NC}"
fi

# Backup current binary
if [ -f "$APOLLO_DIR/backend/node/bitcoind" ]; then
    cp "$APOLLO_DIR/backend/node/bitcoind" "$APOLLO_DIR/backend/node/bitcoind.backup"
    echo -e "${YELLOW} ---> Backed up current bitcoind binary${NC}"
fi

# Copy new binary
echo -e "${YELLOW} ---> Copying $TARGET_SOFTWARE binary${NC}"
cp "$SOURCE_BINARY" "$APOLLO_DIR/backend/node/bitcoind"

# Verify copy was successful
if [ ! -f "$APOLLO_DIR/backend/node/bitcoind" ]; then
    echo -e "${RED}Error: Failed to copy binary${NC}"
    # Restore backup if copy failed
    if [ -f "$APOLLO_DIR/backend/node/bitcoind.backup" ]; then
        cp "$APOLLO_DIR/backend/node/bitcoind.backup" "$APOLLO_DIR/backend/node/bitcoind"
        echo -e "${YELLOW} ---> Restored backup binary${NC}"
    fi
    exit 1
fi

# Make binary executable
chmod +x "$APOLLO_DIR/backend/node/bitcoind"

# Update database with new software selection
echo -e "${YELLOW} ---> Updating database configuration${NC}"
sqlite3 "$APOLLO_DIR/backend/futurebit.sqlite" "UPDATE settings SET node_software = '$TARGET_SOFTWARE' WHERE ID = (SELECT MAX(ID) FROM settings);"

# Copy configuration file
cp "$APOLLO_DIR/backend/default-configs/bitcoin.conf" "$APOLLO_DIR/backend/node/"

# Restore RPC password if exists
PASS=$(sqlite3 "$APOLLO_DIR/backend/futurebit.sqlite" "SELECT node_rpc_password FROM settings ORDER BY id DESC LIMIT 1;")
if [ ! -z "$PASS" ]; then
    sed -i "s/rpcpassword=/rpcpassword=${PASS}/" "$APOLLO_DIR/backend/node/bitcoin.conf"
    echo -e "${GREEN} ---> Restored RPC password${NC}"
fi

# Set max connections to 64 if needed
MAXCONNECTIONS=$(sqlite3 "$APOLLO_DIR/backend/futurebit.sqlite" "SELECT node_max_connections FROM settings ORDER BY id DESC LIMIT 1;")
if [ -z "$MAXCONNECTIONS" ] || [ "$MAXCONNECTIONS" -eq 32 ]; then
    sed -i 's/maxconnections=32/maxconnections=64/' "$APOLLO_DIR/backend/node/bitcoin.conf"
    sqlite3 "$APOLLO_DIR/backend/futurebit.sqlite" "UPDATE settings SET node_max_connections = 64 WHERE ID = (SELECT MAX(ID) FROM settings);"
    echo -e "${GREEN} ---> Set max connections to 64${NC}"
fi

echo -e "${GREEN} ---> Successfully switched to $TARGET_SOFTWARE${NC}"

# Start node service if it was enabled
if systemctl is-enabled --quiet node.service; then
    echo -e "${YELLOW} ---> Starting node service${NC}"
    systemctl start node.service
    
    # Wait a bit and check if service started successfully
    sleep 3
    if systemctl is-active --quiet node.service; then
        echo -e "${GREEN} ---> Node service started successfully${NC}"
    else
        echo -e "${RED}Warning: Node service failed to start${NC}"
        echo -e "${YELLOW} ---> Check logs with: journalctl -u node.service${NC}"
    fi
else
    echo -e "${YELLOW} ---> Node service is not enabled, not starting${NC}"
fi

echo -e "${GREEN} ---> Bitcoin software switch completed${NC}"
echo -e "${YELLOW} ---> Current software: $TARGET_SOFTWARE${NC}"
