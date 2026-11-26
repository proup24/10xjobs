#!/usr/bin/env bash
set -euo pipefail
# Decides whether a deploy starts the worker or leaves it stopped.
# See docs/superpowers/specs/2026-11-26-deploy-keeps-stopped-worker-design.md.
# Prints "start" or "hold". Exits 1 on a docker failure or an unknown state.

if ! out="$(docker ps -a --filter label=com.docker.compose.project=xjobs-engine --filter label=com.docker.compose.service=worker --format '{{.State}}')"; then
  echo "worker-hold: docker ps failed" >&2
  exit 1
fi

hold=0
while IFS= read -r state; do
  state="${state%$'\r'}"
  [ -z "$state" ] && continue
  case "$state" in
    running | restarting)
      echo start
      exit 0
      ;;
    exited | created | paused | dead) hold=1 ;;
    removing) ;;
    *)
      echo "worker-hold: unknown container state '$state'" >&2
      exit 1
      ;;
  esac
done <<<"$out"

if [ "$hold" = 1 ]; then echo hold; else echo start; fi
