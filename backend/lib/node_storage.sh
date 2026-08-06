#!/bin/bash
# Is there somewhere for the Bitcoin node to live?
#
# The launcher and the API both have to answer this, and they have to answer it
# the SAME way — a device the API calls ready and the launcher refuses is a node
# that never starts with nothing on screen to say why. So the answer is computed
# once, here, and both read it.
#
# Some Apollo III ship without an SSD, and a Solo Node can have one seated badly
# or failed. From the outside those look alike, which is why nothing here claims
# a drive is "not installed" — only that none was detected.
#
# Usage:
#   . node_storage.sh          then call  node_storage_state
#   node_storage.sh --json     prints the state as JSON, for the API
#
# States, in the order they are ruled out:
#   no-drive     no NVMe block device at all
#   unformatted  the disk is there, the partition is not
#   not-mounted  the partition is there, nothing is mounted at the mountpoint
#   foreign      something IS mounted there, but not from the node drive
#   ready        mounted, from the right device

NODE_DISK="${NODE_DISK:-/dev/nvme0n1}"
NODE_PARTITION="${NODE_PARTITION:-/dev/nvme0n1p1}"
NODE_MOUNTPOINT="${NODE_MOUNTPOINT:-/media/nvme}"

node_storage_state() {
    # The whole disk, not the partition: an unformatted drive has no partition,
    # and calling that "no drive" would hide the one thing the user can act on.
    if [ ! -b "$NODE_DISK" ] && [ ! -b "$NODE_PARTITION" ]; then
        echo "no-drive"
        return
    fi

    if [ ! -b "$NODE_PARTITION" ]; then
        echo "unformatted"
        return
    fi

    if ! findmnt -rn --target "$NODE_MOUNTPOINT" >/dev/null 2>&1; then
        echo "not-mounted"
        return
    fi

    # Mounted from where? With nothing plugged in, the mountpoint resolves to the
    # root filesystem on the SD card, and writing a blockchain there fills it.
    local mnt_src dev_real src_real
    mnt_src="$(findmnt -rn -o SOURCE --target "$NODE_MOUNTPOINT" 2>/dev/null || true)"
    dev_real="$(readlink -f "$NODE_PARTITION" 2>/dev/null || echo "$NODE_PARTITION")"
    src_real="$(readlink -f "$mnt_src" 2>/dev/null || echo "$mnt_src")"

    if [ -z "$mnt_src" ] || [ "$src_real" != "$dev_real" ]; then
        echo "foreign"
        return
    fi

    echo "ready"
}

# Size of the drive in bytes, or empty when there is nothing to measure. Reported
# so the UI can say WHICH disk it found on a drive that is present but unusable.
node_storage_size() {
    local target="$NODE_DISK"
    [ -b "$target" ] || target="$NODE_PARTITION"
    [ -b "$target" ] || return 0
    lsblk -bdno SIZE "$target" 2>/dev/null | tr -d ' '
}

if [ "${1:-}" = "--json" ]; then
    state="$(node_storage_state)"
    size="$(node_storage_size)"
    printf '{"state":"%s","disk":"%s","partition":"%s","mountpoint":"%s","size":%s}\n' \
        "$state" "$NODE_DISK" "$NODE_PARTITION" "$NODE_MOUNTPOINT" "${size:-null}"
fi
