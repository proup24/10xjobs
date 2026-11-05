#!/usr/bin/env bash
# Prints `export SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=…` for the running
# local Supabase stack, for the seed (and anything else that needs the admin API):
#   eval "$(scripts/supabase-env.sh)"
set -euo pipefail

status="$(pnpm exec supabase status -o env 2>/dev/null)"

value() {
  printf '%s\n' "$status" | sed -n "s/^$1=//p" | head -n 1 | tr -d '"'
}

url="$(value API_URL)"
key="$(value SERVICE_ROLE_KEY)"
if [ -z "$url" ] || [ -z "$key" ]; then
  echo "supabase-env: the Supabase stack is not running (pnpm db:start)" >&2
  exit 1
fi

printf 'export SUPABASE_URL=%s SUPABASE_SERVICE_ROLE_KEY=%s\n' "$url" "$key"
