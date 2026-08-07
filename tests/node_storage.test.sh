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
        # Faithful to the real tool, because the difference is the whole bug:
        # --target answers for the ENCLOSING mount and therefore succeeds even
        # when nothing is mounted at the mountpoint, while --mountpoint answers
        # only for the mountpoint itself. A stub that fails both when nothing is
        # mounted hides a probe that can never report "not-mounted".
        findmnt() {
            case " $* " in
                *" --mountpoint "*)
                    [ -n "$mnt" ] || return 1
                    ;;
                *)
                    # --target: falls back to whatever /media/fake sits inside.
                    [ -n "$mnt" ] || { case " $* " in *" SOURCE "*) echo "/dev/mmcblk1p1" ;; esac; return 0; }
                    ;;
            esac
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
# A drive that is formatted but did not mount — the state the user can fix by
# rebooting. It is only reachable with a probe that asks about the mountpoint
# itself: --target would answer for the enclosing filesystem and call this
# "foreign", which reads as "format the disk" to someone holding a synced chain.
check "partition present, not mounted" "not-mounted" "$(state_with "/dev/fake0 /dev/fake0p1" "")"
check "mounted from the node drive"    "ready"       "$(state_with "/dev/fake0 /dev/fake0p1" "/dev/fake0p1")"

# The one that costs real damage: something else is mounted where the blockchain
# goes, and writing it there fills a disk that is not the one meant for it.
check "mounted from the system disk"   "foreign" \
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

# A late mount is waited for, but missing hardware is not: this also runs on every
# start the user asks for from the UI, and a device with no disk would sit there.
start=$(date +%s)
NODE_STORAGE_WAIT=30 NODE_DISK=/dev/definitely-not-here NODE_PARTITION=/dev/definitely-not-here1 \
    bash "$LIB" --check >/dev/null 2>&1
elapsed=$(( $(date +%s) - start ))
check "does not wait when there is no drive" "quick" \
    "$([ "$elapsed" -lt 3 ] && echo quick || echo "waited ${elapsed}s")"

echo
echo "node_storage_settled_state (the boot race)"

# $1 blocks, $2 findmnt source, $3 wait budget. Prints "<state> waited|quick" —
# the classification, not the seconds, so a slow machine cannot fail it.
settled_with() {
    local blocks="$1" mnt="$2" budget="$3"
    (
        NODE_DISK=/dev/fake0
        NODE_PARTITION=/dev/fake0p1
        NODE_MOUNTPOINT=/media/fake
        NODE_STORAGE_WAIT="$budget"
        # shellcheck disable=SC1090
        . "$LIB"

        node_storage_is_block() {
            case " $blocks " in *" $1 "*) return 0 ;; *) return 1 ;; esac
        }
        findmnt() {
            case " $* " in *" --mountpoint "*) [ -n "$mnt" ] || return 1 ;; esac
            case " $* " in *" SOURCE "*) echo "$mnt" ;; esac
            return 0
        }
        readlink() { echo "$2"; }

        t0=$(date +%s)
        s="$(node_storage_settled_state)"
        if [ $(( $(date +%s) - t0 )) -ge "$budget" ]; then echo "$s waited"; else echo "$s quick"; fi
    )
}

# The mount is done by rc.local, not fstab, so it can land after the unit was
# evaluated. Answering "no" then is not one lost boot: systemd SKIPS the unit,
# and a unit that never went active is never restarted.
check "waits out a mount that has not landed yet" "not-mounted waited" \
    "$(settled_with "/dev/fake0 /dev/fake0p1" "" 3)"

# Nothing about these changes by waiting, and this runs before every start the
# user asks for — stalling one on a device where the answer is already final.
check "does not wait on a foreign mount"  "foreign quick" \
    "$(settled_with "/dev/fake0 /dev/fake0p1" "/dev/mmcblk1p1" 30)"
check "does not wait when the drive is gone" "no-drive quick" "$(settled_with "" "" 30)"
check "does not wait when it is already ready" "ready quick" \
    "$(settled_with "/dev/fake0 /dev/fake0p1" "/dev/fake0p1" 30)"

echo
echo "--- $pass passed, $fail failed"
[ "$fail" -eq 0 ]
