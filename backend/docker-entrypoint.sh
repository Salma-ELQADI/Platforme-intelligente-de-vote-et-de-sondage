#!/bin/sh
set -e

# Apply pending SQL migrations (idempotent, guarded by an advisory lock).
node dist/db/migrate.js

# Demo accounts and polls (idempotent). Disable with SEED_DEMO=false.
if [ "${SEED_DEMO:-true}" = "true" ]; then
  node dist/db/seed.js
fi

exec "$@"
