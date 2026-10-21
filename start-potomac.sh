#!/bin/sh
set -eu
cd "$(dirname "$0")"
exec node scripts/local-launch.mjs start
