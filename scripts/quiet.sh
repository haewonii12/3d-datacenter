#!/bin/sh
# Run a command; print its output only if it fails (keeps `omc ralph verify`
# signatures = failure output only, since it fingerprints every output line).
log=$(mktemp)
"$@" >"$log" 2>&1
code=$?
if [ "$code" -ne 0 ]; then cat "$log"; echo "FAILED (exit $code): $*"; fi
rm -f "$log"
exit "$code"
