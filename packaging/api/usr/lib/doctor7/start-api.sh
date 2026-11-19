#!/bin/bash
# Starts the doctor7 API. The systemd unit runs this file.
# NODE_BIN, when set, comes from /etc/doctor7/api.env through the unit.
set -eu

LIB_DIR=$(dirname "$(readlink -f "$0")")
# shellcheck source=resolve-node.sh
. "$LIB_DIR/resolve-node.sh"

NODE=$(d7_resolve_node) || exit 1

cd "$LIB_DIR/api"
exec "$NODE" src/server.js
