#!/bin/bash
# ExecStart of ckpool.service.

CKPOOL_DIR="${CKPOOL_DIR:-/opt/apolloapi/backend/ckpool}"
CKPOOL_PIDFILE="${CKPOOL_PIDFILE:-/tmp/ckpool/main.pid}"

# Keep the previous run's log (one generation): it is the evidence when a start
# fails, and deleting it blindly destroyed exactly that.
if [ -f "$CKPOOL_DIR/logs/ckpool.log" ]; then
    mv -f "$CKPOOL_DIR/logs/ckpool.log" "$CKPOOL_DIR/logs/ckpool.log.1"
fi

# A pid file left by a ckpool that is gone (or whose pid another process has
# since reused) would be met by the new instance: remove it unless it names our
# own ckpool, checked the way ckpool_stop.sh does.
if [ -f "$CKPOOL_PIDFILE" ]; then
    pid="$(tr -dc '0-9' < "$CKPOOL_PIDFILE" 2>/dev/null)"
    ours=0
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        args="$(ps -o args= -p "$pid" 2>/dev/null)"
        case "$args" in "$CKPOOL_DIR/ckpool"|"$CKPOOL_DIR/ckpool "*) ours=1 ;; esac
    fi
    [ "$ours" = 1 ] || rm -f "$CKPOOL_PIDFILE"
fi

# CKPOOL_SCREEN lets a test stand in for screen.
exec ${CKPOOL_SCREEN:-screen} -dmS ckpool "$CKPOOL_DIR/ckpool" -B -c "$CKPOOL_DIR/ckpool.conf"
