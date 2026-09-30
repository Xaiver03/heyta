#!/bin/bash
# Send a local .ps1 to windows-pc as base64(UTF-16LE) EncodedCommand.
#   ps.sh script.ps1 [host]
# Also: psrun.sh '<one-liner>' [host]
set -euo pipefail
HOST="${2:-windows-pc}"
b64="$(iconv -f UTF-8 -t UTF-16LE "$1" | base64 | tr -d '\n')"
ssh -o ConnectTimeout=20 "$HOST" "powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand $b64"