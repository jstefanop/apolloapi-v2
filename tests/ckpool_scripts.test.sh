#!/bin/bash
# ckpool_stop.sh / ckpool_start.sh, run for real with a stand-in "ckpool" (a copy
# of sleep under a ckpool path) and a stub screen.
#
# What this guards: `screen -X quit` returns before ckpool is gone, so a restart
# started the new ckpool on top of the old one; it exited, the unit failed, and
# systemd retried 30 s later. The stop script must not return until ckpool is gone.
#
# Run: bash tests/ckpool_scripts.test.sh   (bash 3.2 and 5)

set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/backend/ckpool"
tmp="$(mktemp -d)"
pids=""
cleanup() { for p in $pids; do kill -KILL "$p" 2>/dev/null; done; rm -rf "$tmp"; }
trap cleanup EXIT

pass=0; fail=0
check() {
    if [ "$2" = "$3" ]; then pass=$((pass + 1)); printf '  ok   %s\n' "$1"
    else fail=$((fail + 1)); printf '  FAIL %s — expected [%s], got [%s]\n' "$1" "$2" "$3"; fi
}
alive() { kill -0 "$1" 2>/dev/null && echo 1 || echo 0; }

# Stand-in "ckpool": a bash started with argv0 = $BIN (a copy of a system binary
# is killed by macOS code signing), see spawn(). A screen stub that does what `screen -X quit` does: signals
# the child (the stub's behaviour is set per test by $SCREEN_ACTION) and returns.
mkdir -p "$tmp/bin" "$tmp/run"
BIN="$tmp/run/ckpool"
cat > "$tmp/bin/screen" <<'STUB'
#!/bin/bash
echo "screen $*" >> "$STUB_LOG"
case "${SCREEN_ACTION:-none}" in
    hup) [ -n "${TARGET_PID:-}" ] && kill -TERM "$TARGET_PID" 2>/dev/null ;;
    fail) echo "No screen session found." >&2; exit 1 ;;
esac
exit 0
STUB
chmod +x "$tmp/bin/screen"

export PATH="$tmp/bin:$PATH" STUB_LOG="$tmp/screen.log"
export CKPOOL_BIN="$BIN" CKPOOL_PIDFILE="$tmp/run/main.pid"
export CKPOOL_STOP_WAIT=3 CKPOOL_STOP_TERM_WAIT=2 CKPOOL_STOP_KILL_WAIT=2

# spawn <ignore-term:0|1>: a ckpool that lives 300 s; prints its pid.
# An optional second argument is the argv0 to use instead of $BIN.
spawn() {
    local trap_cmd="" argv0="${2:-$BIN}"
    [ "$1" = 1 ] && trap_cmd="trap '' TERM;"
    ( exec -a "$argv0" bash -c "$trap_cmd i=0; while [ \$i -lt 300 ]; do sleep 1; i=\$((i+1)); done" ) >/dev/null 2>&1 &
    pids="$pids $!"; echo $!
}
now() { date +%s; }

# 1. ckpool exits shortly after the quit request: the script waits for it.
: > "$STUB_LOG"
pid="$(spawn 0)"; echo "$pid" > "$CKPOOL_PIDFILE"
( sleep 1; kill -TERM "$pid" ) >/dev/null 2>&1 &
t0="$(now)"
SCREEN_ACTION=none bash "$DIR/ckpool_stop.sh" >/dev/null 2>&1; rc=$?
el=$(( $(now) - t0 ))
check "stop: exits 0"                         "0" "$rc"
check "stop: ckpool is gone when it returns"  "0" "$(alive "$pid")"
check "stop: it waited for the exit (>=1 s)"  "1" "$( [ "$el" -ge 1 ] && echo 1 || echo 0 )"
check "stop: asked screen to quit"            "1" "$(grep -c 'screen -X -S ckpool quit' "$STUB_LOG")"
check "stop: pid file removed once gone"      "0" "$( [ -e "$CKPOOL_PIDFILE" ] && echo 1 || echo 0 )"

# 2. ckpool never exits on its own: TERM ends it.
pid="$(spawn 0)"; echo "$pid" > "$CKPOOL_PIDFILE"
SCREEN_ACTION=none bash "$DIR/ckpool_stop.sh" >"$tmp/out" 2>&1; rc=$?
check "TERM: exits 0"                  "0" "$rc"
check "TERM: ckpool is gone"           "0" "$(alive "$pid")"
check "TERM: says it sent TERM"        "1" "$(grep -c 'sending TERM' "$tmp/out")"
check "TERM: did not need KILL"        "0" "$(grep -c 'sending KILL' "$tmp/out")"

# 3. ckpool ignores TERM too: KILL.
pid="$(spawn 1)"; echo "$pid" > "$CKPOOL_PIDFILE"
SCREEN_ACTION=none bash "$DIR/ckpool_stop.sh" >"$tmp/out" 2>&1; rc=$?
check "KILL: exits 0"                  "0" "$rc"
check "KILL: ckpool is gone"           "0" "$(alive "$pid")"
check "KILL: says it sent KILL"        "1" "$(grep -c 'sending KILL' "$tmp/out")"
check "KILL: pid file removed"         "0" "$( [ -e "$CKPOOL_PIDFILE" ] && echo 1 || echo 0 )"

# 4. Nothing running, screen says "No screen session": already stopped, not an error.
rm -f "$CKPOOL_PIDFILE"
t0="$(now)"
SCREEN_ACTION=fail bash "$DIR/ckpool_stop.sh" >/dev/null 2>&1; rc=$?
check "idle: exits 0 with no session"  "0" "$rc"
check "idle: returns at once"          "1" "$( [ $(( $(now) - t0 )) -le 1 ] && echo 1 || echo 0 )"

# 5. Stale pid file (dead pid): removed, exit 0.
echo 999999 > "$CKPOOL_PIDFILE"
SCREEN_ACTION=fail bash "$DIR/ckpool_stop.sh" >/dev/null 2>&1; rc=$?
check "stale: exits 0"                 "0" "$rc"
check "stale: pid file removed"        "0" "$( [ -e "$CKPOOL_PIDFILE" ] && echo 1 || echo 0 )"

# 6. Someone else's process: a pid file pointing at an unrelated live process,
# and a same-named sleep that is not our binary, are never touched.
( exec sleep 300 ) >/dev/null 2>&1 & other=$!; pids="$pids $other"
echo "$other" > "$CKPOOL_PIDFILE"
SCREEN_ACTION=fail bash "$DIR/ckpool_stop.sh" >/dev/null 2>&1; rc=$?
check "foreign: exits 0"               "0" "$rc"
check "foreign: unrelated process survives" "1" "$(alive "$other")"
kill -KILL "$other" 2>/dev/null

# 7. pgrep branch alone: no pid file at all, only the process list finds ckpool.
rm -f "$CKPOOL_PIDFILE"
pid="$(spawn 0)"
SCREEN_ACTION=none bash "$DIR/ckpool_stop.sh" >/dev/null 2>&1; rc=$?
check "pgrep: exits 0"                       "0" "$rc"
check "pgrep: found without a pid file, stopped" "0" "$(alive "$pid")"

# 8. Baits owned by the same user that mention the path but are not ckpool: a
# process whose command line merely CONTAINS the path (not at the start), and
# one whose path differs only where the real one has a dot (regex escaping).
bait1="$(spawn 0 "/usr/bin/other $BIN")"
dotless="$(printf '%s' "$BIN" | sed 's/\./Z/')"
bait2="$(spawn 0 "$dotless")"
real="$(spawn 0)"
SCREEN_ACTION=none bash "$DIR/ckpool_stop.sh" >/dev/null 2>&1; rc=$?
check "bait: exits 0"                          "0" "$rc"
check "bait: real ckpool stopped"              "0" "$(alive "$real")"
check "bait: path only mid-cmdline survives"   "1" "$(alive "$bait1")"
check "bait: path differing at a dot survives" "1" "$(alive "$bait2")"
kill -KILL "$bait1" "$bait2" 2>/dev/null

# --- ckpool_start.sh ---
export CKPOOL_DIR="$tmp/cp" CKPOOL_SCREEN="$tmp/bin/screen"
mkdir -p "$CKPOOL_DIR/logs"

# Log rotated, not deleted; one generation kept.
echo "run one" > "$CKPOOL_DIR/logs/ckpool.log"
rm -f "$CKPOOL_PIDFILE"; : > "$STUB_LOG"
bash "$DIR/ckpool_start.sh" >/dev/null 2>&1; rc=$?
check "start: exits 0"                      "0" "$rc"
check "start: previous log kept as .1"      "run one" "$(cat "$CKPOOL_DIR/logs/ckpool.log.1")"
check "start: old log moved away"           "0" "$( [ -e "$CKPOOL_DIR/logs/ckpool.log" ] && echo 1 || echo 0 )"
check "start: launched ckpool in screen"    "1" "$(grep -c -- "-dmS ckpool $CKPOOL_DIR/ckpool -B -c $CKPOOL_DIR/ckpool.conf" "$STUB_LOG")"
echo "run two" > "$CKPOOL_DIR/logs/ckpool.log"
bash "$DIR/ckpool_start.sh" >/dev/null 2>&1
check "start: only one generation kept"     "run two" "$(cat "$CKPOOL_DIR/logs/ckpool.log.1")"
bash "$DIR/ckpool_start.sh" >/dev/null 2>&1; rc=$?
check "start: no log at all is fine"        "0" "$rc"

# Stale pid file removed; a live one kept.
echo 999999 > "$CKPOOL_PIDFILE"
bash "$DIR/ckpool_start.sh" >/dev/null 2>&1
check "start: stale pid file removed"       "0" "$( [ -e "$CKPOOL_PIDFILE" ] && echo 1 || echo 0 )"
( exec sleep 300 ) >/dev/null 2>&1 & live=$!; pids="$pids $live"
echo "$live" > "$CKPOOL_PIDFILE"
bash "$DIR/ckpool_start.sh" >/dev/null 2>&1
check "start: pid file naming a live NON-ckpool process removed" "0" "$( [ -e "$CKPOOL_PIDFILE" ] && echo 1 || echo 0 )"
mine="$(spawn 0 "$CKPOOL_DIR/ckpool")"
echo "$mine" > "$CKPOOL_PIDFILE"
bash "$DIR/ckpool_start.sh" >/dev/null 2>&1
check "start: pid file naming our live ckpool kept" "1" "$( [ -e "$CKPOOL_PIDFILE" ] && echo 1 || echo 0 )"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
