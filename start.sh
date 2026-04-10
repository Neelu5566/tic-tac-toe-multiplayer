#!/bin/sh
set -e
# Render provides DATABASE_URL as postgres:// or postgresql://
# Nakama expects user:pass@host:port/db (no scheme prefix)
DB_ADDR=$(echo "$DATABASE_URL" | sed 's|^postgresql://||;s|^postgres://||')
exec /nakama/nakama --name nakama1 --database.address "$DB_ADDR"
