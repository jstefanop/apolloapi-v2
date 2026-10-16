#!/bin/bash
# ExecStart of ckpool.service.

CKPOOL_DIR="${CKPOOL_DIR:-/opt/apolloapi/backend/ckpool}"
CKPOOL_PIDFILE="${CKPOOL_PIDFILE:-/tmp/ckpool/main.pid}"

# Keep the previous run's log (one generation): it is the evidence when a start
# fails, and deleting it blindly destroyed exactly that.
if [ -f "$CKPOOL_DIR/logs/ckpool.log" ]; then
    mv -f "$CKPOOL_DIR/logs/ckpool.log" "$CKPOOL_DIR/logs/ckpool.log.1"
fi

# A pid file whose process is gone (or is not ours any more) is left over from a
# crash; ckpool would trip over it.
if [ -f "$CKPOOL_PIDFILE" ]; then
    pid="$(tr -dc '0-9' < "$CKPOOL_PIDFILE" 2>/dev/null)"
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$CKPOOL_PIDFILE"
    fi
fi

# CKPOOL_SCREEN lets a test stand in for screen.
exec ${CKPOOL_SCREEN:-screen} -dmS ckpool "$CKPOOL_DIR/ckpool" -B -c "$CKPOOL_DIR/ckpool.conf"
