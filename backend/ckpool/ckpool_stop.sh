#!/bin/bash
set -Eeuo pipefail

SCREEN_SESSION="${APOLLO_CKPOOL_SCREEN_SESSION:-ckpool}"

screen -S "$SCREEN_SESSION" -X quit >/dev/null 2>&1 || true
