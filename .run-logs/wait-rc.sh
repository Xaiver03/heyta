#!/bin/bash
L=".run-logs/reinstall.log"
for i in $(seq 1 100); do
  if grep -q '^REINSTALL_RC=' "$L" 2>/dev/null; then
    echo "MARKER_FOUND after ${i} polls"
    grep -E '^(REINSTALL_RC|═══|  ✅|  🔴|  ⚠️|  ADD_APPX|  RESULT|  PAYLOAD_WEBDIST|  M2D)' "$L" | tail -60
    exit 0
  fi
  sleep 30
done
echo "TIMEOUT_50MIN still running"; tail -5 "$L"; exit 3
