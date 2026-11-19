#!/bin/bash
# Finds a Node.js binary for the doctor7 services. Source this file; do not run it.
#
# Order: NODE_BIN (from /etc/doctor7/api.env), /opt/node/current/bin/node, then
# `node` from PATH. A candidate must be executable and be version
# D7_NODE_MIN_MAJOR or later. A candidate that is set but unusable gets a
# warning on stderr, and the next one is tried.

D7_NODE_MIN_MAJOR=22
D7_NODE_OPT_PATH=/opt/node/current/bin/node

# Succeeds when $1 is an executable Node of the required major version.
d7_node_ok() {
  local candidate=$1 major
  [ -n "$candidate" ] && [ -f "$candidate" ] && [ -x "$candidate" ] || return 1
  major=$("$candidate" -p 'process.versions.node.split(".")[0]' 2>/dev/null) || return 1
  case $major in
    '' | *[!0-9]*) return 1 ;;
  esac
  [ "$major" -ge "$D7_NODE_MIN_MAJOR" ]
}

# Prints the path of the Node binary to use. On failure prints a message to
# stderr and returns 1.
d7_resolve_node() {
  local candidate from_path
  from_path=$(command -v node 2>/dev/null || true)

  if [ -n "${NODE_BIN:-}" ]; then
    if d7_node_ok "$NODE_BIN"; then
      printf '%s\n' "$NODE_BIN"
      return 0
    fi
    printf 'doctor7: NODE_BIN is set but is not a usable Node.js %s or later. Trying the next option.\n' \
      "$D7_NODE_MIN_MAJOR" >&2
  fi

  for candidate in "$D7_NODE_OPT_PATH" "$from_path"; do
    if d7_node_ok "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  printf 'doctor7: no usable Node.js %s or later was found. Set NODE_BIN in /etc/doctor7/api.env, install Node.js at %s, or put node in PATH.\n' \
    "$D7_NODE_MIN_MAJOR" "$D7_NODE_OPT_PATH" >&2
  return 1
}
