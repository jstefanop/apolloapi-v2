#!/bin/bash
# The node storage state machine, exercised without a disk.
#
# It matters that this is tested at all: the launcher and the API both read this
# answer, and a disagreement between them is a node that silently never starts.
# Block devices cannot be conjured without root, so the two probes it depends on
# — "is this a block device" and "what is mounted there" — are shadowed here.
#
# Run: bash tests/node_storage.test.sh

set -u

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/backend/lib/node_storage.sh"

pass=0
fail=0

check() {
    local name="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        pass=$((pass + 1))
        printf '  ok   %s\n' "$name"
    else
        fail=$((fail + 1))
        printf '  FAIL %s — expected %s, got %s\n' "$name" "$expected" "$actual"
    fi
}

# Each case runs in a subshell so the shadowed probes never leak into the next.
state_with() {
    # $1 blocks (space separated paths that "exist"), $2 findmnt source ("" = not mounted)
    local blocks="$1" mnt="$2"
    (
        NODE_DISK=/dev/fake0
        NODE_PARTITION=/dev/fake0p1
        NODE_MOUNTPOINT=/media/fake
        # shellcheck disable=SC1090
        . "$LIB"

        node_storage_is_block() {
            case " $blocks " in *" $1 "*) return 0 ;; *) return 1 ;; esac
        }
        findmnt() {
            [ -n "$mnt" ] || return 1
            # Only -o SOURCE is asked for; the bare form is the existence probe.
            case " $* " in *" SOURCE "*) echo "$mnt" ;; esac
            return 0
        }
        readlink() { echo "$2"; }   # no symlinks in the fake tree

        node_storage_state
    )
}

echo "node_storage_state"

check "no disk at all"                 "no-drive"    "$(state_with "" "")"
check "disk present, no partition"     "unformatted" "$(state_with "/dev/fake0" "")"
check "partition present, not mounted" "not-mounted" "$(state_with "/dev/fake0 /dev/fake0p1" "")"
check "mounted from the node drive"    "ready"       "$(state_with "/dev/fake0 /dev/fake0p1" "/dev/fake0p1")"

# The one that costs real damage: with nothing plugged in, /media/nvme resolves to
# the SD card, and a blockchain written there fills the system disk.
check "mountpoint falls through to root" "foreign" \
    "$(state_with "/dev/fake0 /dev/fake0p1" "/dev/mmcblk1p1")"

# A partition that exists but was never the one mounted — a second drive, or a
# stale fstab entry. Same verdict: do not write there.
check "mounted from another device"    "foreign"     \
    "$(state_with "/dev/fake0 /dev/fake0p1" "/dev/sda1")"

# Only the partition visible (some controllers enumerate it without the parent):
# still usable, and calling it "no drive" would be wrong.
check "partition without parent disk"  "ready"       \
    "$(state_with "/dev/fake0p1" "/dev/fake0p1")"

echo
echo "--check (systemd ExecCondition)"

# Exercised for real, no shadowing: nothing is plugged in at these paths. The
# exit code is the whole contract — 0 starts the node, 1 makes systemd skip the
# unit, and anything else (255, a crash) makes systemd fail it and loop again.
NODE_DISK=/dev/definitely-not-here NODE_PARTITION=/dev/definitely-not-here1 \
    bash "$LIB" --check 2>/dev/null
check "refuses with 1 when there is no drive" "1" "$?"

check "says which state refused it" "no usable node drive (no-drive); not starting bitcoind" \
    "$(NODE_DISK=/dev/definitely-not-here NODE_PARTITION=/dev/definitely-not-here1 \
        bash "$LIB" --check 2>&1 >/dev/null)"

echo
echo "--- $pass passed, $fail failed"
[ "$fail" -eq 0 ]
