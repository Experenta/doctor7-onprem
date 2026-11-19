#!/bin/bash
# Starts the demo sign-in provider. The systemd unit runs this file.
# Demo only. Never run this on a production server.
#
# The Node.js lookup comes from doctor7-api (resolve-node.sh), in this order:
# NODE_BIN from /etc/doctor7/idp-demo.env, /opt/node/current/bin/node, then node
# from PATH. The first one that is version 22 or later is used.
set -eu

LIB_DIR=$(dirname "$(readlink -f "$0")")
# shellcheck source=resolve-node.sh
. "$LIB_DIR/resolve-node.sh"

NODE=$(d7_resolve_node) || {
  echo "doctor7-idp: install Node.js 22 or later at /opt/node/current/bin/node or in PATH, or set NODE_BIN in /etc/doctor7/idp-demo.env." >&2
  exit 1
}

cd "$LIB_DIR/mock-idp"
exec "$NODE" server.js
