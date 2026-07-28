#!/bin/bash
# Establish persistent, crash-surviving journald. Shared by every provisioning
# flow so "install the journald policy" is one fact in one place — the moment it
# was copy-pasted per flow, the Solo Node installer was silently left without it.
#
# Does NOT restart journald: on the update path the caller reboots (restarting
# journald under the live services an update runs beneath can blip their journal
# connection). Install flows restart it themselves, where services are still
# being set up and a blip is harmless.
set -e
APOLLO_DIR="${APOLLO_DIR:-/opt/apolloapi}"

# Storage=persistent writes to /var/log/journal — but that only reaches the eMMC
# if it resolves there. On these Armbian images /var/log is a zram ramdisk and
# only /var/log.hdd is the real disk, so a plain /var/log/journal directory would
# put the journal in RAM: capped at SystemMaxUse and still gone on the very hang
# it exists to survive. Establish the path, don't assume it (the assumption held
# on apollo2, but 2.1.x images are not guaranteed uniform).
if [ -d /var/log.hdd ]; then
  mkdir -p /var/log.hdd/journal
  if [ "$(readlink -f /var/log/journal 2>/dev/null)" != /var/log.hdd/journal ]; then
    # Never delete an existing journal: this runs on every update, and the
    # archives under /var/log/journal are exactly the crash evidence the whole
    # change exists to preserve — including the previous boot someone is updating
    # in order to diagnose. Move the history across instead, and only replace the
    # path once it is safe to do so.
    if [ -d /var/log/journal ] && [ ! -L /var/log/journal ]; then
      cp -a /var/log/journal/. /var/log.hdd/journal/ 2>/dev/null || true
      mv /var/log/journal "/var/log/journal.migrated.$$" 2>/dev/null || true
      rm -rf "/var/log/journal.migrated.$$" 2>/dev/null || true
    else
      # A symlink pointing somewhere else, or nothing at all: no history to lose.
      rm -rf /var/log/journal
    fi
    ln -sfn /var/log.hdd/journal /var/log/journal
  fi
elif [ "$(findmnt -no FSTYPE /var/log 2>/dev/null)" = tmpfs ]; then
  # RAM-backed /var/log with no disk split to redirect to: warn loudly rather
  # than fail silently, so this surfaces instead of quietly filling RAM.
  echo "[journald] WARNING: /var/log is RAM-backed and /var/log.hdd is absent —" >&2
  echo "[journald] the persistent journal will not survive an abrupt crash here." >&2
  mkdir -p /var/log/journal
else
  # /var/log is already on a disk-backed mount: a plain directory lands on disk.
  mkdir -p /var/log/journal
fi

mkdir -p /etc/systemd/journald.conf.d
cp "$APOLLO_DIR/backend/systemd/journald-apollo.conf" /etc/systemd/journald.conf.d/apollo.conf
