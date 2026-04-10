#!/bin/sh
set -e

# Fix ownership of the data directory (bind-mounted from host, may be owned by host UID).
# Runs as root before dropping to appuser via su-exec.
chown -R appuser:appgroup /app/data 2>/dev/null || true

echo "Running database migrations..."
su-exec appuser packages/db/node_modules/.bin/prisma migrate deploy --schema /app/prisma/schema.prisma

echo "Starting server..."
exec su-exec appuser node apps/backend/dist/main.js
