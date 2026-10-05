#!/bin/bash
set -euo pipefail
pnpm install --frozen-lockfile
node scripts/prepare-schema-push.cjs
schema_log=$(mktemp)
trap 'rm -f "$schema_log"' EXIT
pnpm --filter @workspace/db push 2>&1 | tee "$schema_log"
# drizzle-kit can print database errors but still exit zero.
if grep -Eq '(^error:|Error:|severity: .ERROR.|severity: .FATAL.)' "$schema_log"; then
  echo "Schema reconciliation reported an error." >&2
  exit 1
fi
