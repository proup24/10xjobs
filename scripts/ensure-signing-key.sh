#!/usr/bin/env bash
# Creates supabase/signing_keys.json (a gitignored ES256 key) if it is missing, so
# local Supabase signs user tokens asymmetrically. Idempotent and silent on success.
set -euo pipefail

cd "$(dirname "$0")/.."

file=supabase/signing_keys.json
[ -s "$file" ] && exit 0

# With signing_keys_path set, the CLI reads the file and writes the new key into it
# (a JSON array of JWKs), so start from an empty array. It never prints the key then.
tmp="$(mktemp "$file.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
echo '[]' >"$tmp"
chmod 600 "$tmp"
mv "$tmp" "$file"
if ! pnpm exec supabase gen signing-key --algorithm ES256 --append >/dev/null 2>&1; then
  rm -f "$file"
  echo "ensure-signing-key: supabase gen signing-key failed" >&2
  exit 1
fi
