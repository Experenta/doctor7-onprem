#!/bin/bash
# Runs a one-off API task with the same Node lookup as the service.
# Usage: run-task.sh migrate [up|down [steps]|status]
#        run-task.sh purge
# The settings come from the environment. Under systemd that is api.env. From a
# shell, load them first, for example:
#   systemd-run --wait --pipe -p EnvironmentFile=/etc/doctor7/api.env \
#     -p User=doctor7 /usr/lib/doctor7/run-task.sh migrate status
set -eu

LIB_DIR=$(dirname "$(readlink -f "$0")")
# shellcheck source=resolve-node.sh
. "$LIB_DIR/resolve-node.sh"

if [ $# -lt 1 ]; then
  printf 'Usage: run-task.sh migrate [up|down [steps]|status] | purge\n' >&2
  exit 2
fi

task=$1
shift

case $task in
  migrate)
    script=src/db/migrations.js
    if [ $# -eq 0 ]; then
      set -- up
    fi
    ;;
  purge)
    script=src/chat/purge.js
    ;;
  *)
    printf 'doctor7: unknown task. Use migrate or purge.\n' >&2
    exit 2
    ;;
esac

NODE=$(d7_resolve_node) || exit 1

cd "$LIB_DIR/api"
exec "$NODE" "$script" "$@"
