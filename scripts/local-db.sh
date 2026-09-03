#!/usr/bin/env bash
# Starts the local development MongoDB.
#
# Uses the mongod binary that mongodb-memory-server already downloaded, but points it at a
# persistent folder (.localdb/data) instead of a throwaway one — so data survives restarts.
# Run this once after booting your Mac; it keeps running in the background.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGOD="$ROOT/node_modules/.cache/mongodb-memory-server/mongod-arm64-darwin-8.2.6"
PORT=27018

if [ ! -x "$MONGOD" ]; then
  echo "mongod binary not found at:"
  echo "  $MONGOD"
  echo
  echo "It is downloaded on demand by mongodb-memory-server. Run 'npm test' once to fetch it,"
  echo "then re-run this script."
  exit 1
fi

if nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
  echo "Local MongoDB already running on port $PORT."
  exit 0
fi

mkdir -p "$ROOT/.localdb/data" "$ROOT/.localdb/log"
nohup "$MONGOD" \
  --dbpath "$ROOT/.localdb/data" \
  --port "$PORT" \
  --bind_ip 127.0.0.1 \
  > "$ROOT/.localdb/log/mongod.log" 2>&1 &
disown

for _ in $(seq 1 20); do
  if nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
    echo "Local MongoDB running on mongodb://127.0.0.1:$PORT"
    echo "Data:  $ROOT/.localdb/data"
    echo "Log:   $ROOT/.localdb/log/mongod.log"
    exit 0
  fi
  sleep 0.5
done

echo "MongoDB did not come up in time — check .localdb/log/mongod.log"
exit 1
