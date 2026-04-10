#!/bin/sh
set -e
# Render provides DATABASE_URL as postgres:// or postgresql://
# Nakama expects user:pass@host:port/db (no scheme prefix)
DB_ADDR=$(echo "$DATABASE_URL" | sed 's|^postgresql://||;s|^postgres://||')
# Render provides PORT env var; Nakama uses --socket.server_key and listens on 7350 by default
# We expose port 7350 and use Render's port mapping via the socket port flag
exec /nakama/nakama --name nakama1 --database.address "$DB_ADDR" --socket.port "${PORT:-7350}"
