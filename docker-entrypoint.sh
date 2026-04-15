#!/bin/sh
set -e

# Fix ownership of the data directory volume.
# Runs as root before dropping to appuser via su-exec.
chown -R appuser:appgroup /app/data 2>/dev/null || true

echo "Starting server..."
exec su-exec appuser node apps/backend/dist/main.js
