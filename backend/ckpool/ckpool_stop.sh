#!/bin/bash
# ExecStop of ckpool.service. `screen -X quit` only *asks* and returns at once;
# this waits until ckpool has really exited (TERM, then KILL, if it is slow), so
# it gets its graceful quit before systemd would signal the whole cgroup. Having
# nothing to stop is a success: "No screen session found" is the "already
# stopped" case, not an error (it used to fail the unit).
#
# What is established about the failed restart seen on the Solo Node: the new
# ckpool exited about a second after "Started". Whether the old instance was
# still alive then is NOT proven (ckpool runs inside the unit's cgroup, which
# systemd signals after ExecStop). The likelier cause is the leftovers of a
# killed ckpool in /tmp/ckpool (main.pid, unix sockets), which ckpool_start.sh
# now clears when the process they name is gone.

CKPOOL_BIN="${CKPOOL_BIN:-/opt/apolloapi/backend/ckpool/ckpool}"
CKPOOL_PIDFILE="${CKPOOL_PIDFILE:-/tmp/ckpool/main.pid}"
WAIT_QUIT="${CKPOOL_STOP_WAIT:-20}"   # seconds after the polite request
WAIT_TERM="${CKPOOL_STOP_TERM_WAIT:-5}"
WAIT_KILL="${CKPOOL_STOP_KILL_WAIT:-3}"

# The binary path as a regex: its dots and the like must not match anything else.
bin_re="$(printf '%s' "$CKPOOL_BIN" | sed 's/[][\.*^$+?(){}|\/]/\\&/g')"

# Pids of OUR ckpool: this binary, this user. Never anybody else's process.
ckpool_pids() {
    local pid args
    pgrep -u "$(id -u)" -f "^${bin_re}( |\$)" 2>/dev/null
    if [ -r "$CKPOOL_PIDFILE" ]; then
        pid="$(tr -dc '0-9' < "$CKPOOL_PIDFILE" 2>/dev/null)"
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            args="$(ps -o args= -p "$pid" 2>/dev/null)"
            case "$args" in "$CKPOOL_BIN"|"$CKPOOL_BIN "*) echo "$pid" ;; esac
        fi
    fi
}

running() { [ -n "$(ckpool_pids)" ]; }

# wait_gone <seconds>: poll until nothing runs, in 0.2 s steps.
wait_gone() {
    local ticks=$(( $1 * 5 )) i=0
    while running; do
        [ "$i" -ge "$ticks" ] && return 1
        sleep 0.2
        i=$((i + 1))
    done
    return 0
}

screen -X -S ckpool quit >/dev/null 2>&1

if ! wait_gone "$WAIT_QUIT"; then
    echo "ckpool still running ${WAIT_QUIT}s after quit, sending TERM"
    # shellcheck disable=SC2046
    kill -TERM $(ckpool_pids | sort -u) 2>/dev/null
    if ! wait_gone "$WAIT_TERM"; then
        echo "ckpool ignored TERM, sending KILL"
        # shellcheck disable=SC2046
        kill -KILL $(ckpool_pids | sort -u) 2>/dev/null
        wait_gone "$WAIT_KILL"
    fi
fi

# A pid file nobody owns would be met by the next start.
running || rm -f "$CKPOOL_PIDFILE"
exit 0
