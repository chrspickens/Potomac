#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ "$#" -ne 1 ]; then
  echo "Usage: ./reset-playtest.sh <playtest-id>" >&2
  exit 2
fi
exec node scripts/local-launch.mjs reset-playtest "$1"
