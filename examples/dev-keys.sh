#!/usr/bin/env bash
# Creates throw-away keys for LOCAL DEVELOPMENT ONLY (never use them in production).
#
#   esadad-dev.key / esadad-dev.cer  → plays the role of E-SADAD (used by simulate-esadad.ts)
#   biller-dev.pfx / biller-dev.cer  → your biller key (used by your server)
#
# Usage:  bash examples/dev-keys.sh [output-folder]   (default: ./dev-keys)
set -euo pipefail
OUT="${1:-dev-keys}"
PASSWORD="${BILLER_PFX_PASSWORD:-dev-password}"
mkdir -p "$OUT"

openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=esadad-dev" \
  -keyout "$OUT/esadad-dev.key" -out "$OUT/esadad-dev.cer" 2>/dev/null
openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=biller-dev" \
  -keyout "$OUT/biller-dev.key" -out "$OUT/biller-dev.cer" 2>/dev/null
openssl pkcs12 -export -inkey "$OUT/biller-dev.key" -in "$OUT/biller-dev.cer" \
  -out "$OUT/biller-dev.pfx" -passout "pass:$PASSWORD"
rm "$OUT/biller-dev.key"   # the .pfx now holds the biller private key

echo "Dev keys written to $OUT/ (PFX password: $PASSWORD)"
echo "Add '$OUT/' to .gitignore — keys must never be committed."
