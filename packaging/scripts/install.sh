#!/bin/bash
# First install of the doctor7 packages on a Debian server.
#
# Usage: install.sh <directory-with-debs> [api|web|all]
#
# The directory holds doctor7-api_*.deb and doctor7-web_*.deb. The script checks
# the host, installs the packages with apt-get, and prints the steps that remain.
# It does not install Node.js, MariaDB or a TLS certificate.
set -euo pipefail

die() {
  printf 'install: %s\n' "$*" >&2
  exit 1
}

[ $# -ge 1 ] && [ $# -le 2 ] || die "usage: install.sh <directory-with-debs> [api|web|all]"
DIR=$1
WHAT=${2:-all}
case $WHAT in
  api | web | all) ;;
  *) die "the second argument must be api, web or all." ;;
esac

[ "$(id -u)" -eq 0 ] || die "run as root."
[ -d "$DIR" ] || die "directory not found: $DIR"
command -v apt-get >/dev/null 2>&1 || die "apt-get was not found. This script is for Debian."
if [ -r /etc/os-release ]; then
  # shellcheck source=/dev/null
  ID=$(. /etc/os-release && printf '%s' "${ID:-}")
  [ "$ID" = debian ] || printf 'install: warning: this host is not Debian (%s). The packages target Debian 13.\n' "${ID:-unknown}" >&2
fi

# Prints the only file that matches a pattern. Fails on none or several.
one_deb() {
  local pattern=$1 matches=()
  shopt -s nullglob
  matches=("$DIR"/$pattern)
  shopt -u nullglob
  [ "${#matches[@]}" -eq 1 ] || die "expected one file matching $pattern in $DIR, found ${#matches[@]}."
  printf '%s\n' "${matches[0]}"
}

# Warns when no Node.js 22 or later can be found yet. NODE_BIN may be set later in api.env.
check_node() {
  local candidate major
  for candidate in "${NODE_BIN:-}" /opt/node/current/bin/node "$(command -v node 2>/dev/null || true)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      major=$("$candidate" -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf 0)
      if [ "$major" -ge 22 ] 2>/dev/null; then
        printf 'install: Node.js %s found at %s\n' "$major" "$candidate"
        return 0
      fi
    fi
  done
  printf 'install: warning: no Node.js 22 or later found. Install it at /opt/node/current/bin/node or set NODE_BIN in /etc/doctor7/api.env.\n' >&2
}

debs=()
if [ "$WHAT" = api ] || [ "$WHAT" = all ]; then
  debs+=("$(one_deb 'doctor7-api_*_all.deb')")
  check_node
  command -v mariadb-dump >/dev/null 2>&1 || printf 'install: warning: mariadb-client is not installed, so doctor7-backup cannot dump the database.\n' >&2
fi
if [ "$WHAT" = web ] || [ "$WHAT" = all ]; then
  debs+=("$(one_deb 'doctor7-web_*_all.deb')")
fi

# apt-get needs a path with a slash to read a local file.
abs=()
for deb in "${debs[@]}"; do
  abs+=("$(readlink -f "$deb")")
done
apt-get install -y "${abs[@]}"

cat <<'EOF'

Installed. Next steps:
  API  1. Edit /etc/doctor7/api.env (DATABASE_URL is required).
       2. Create /etc/doctor7/backup.conf values and /etc/doctor7/backup.cnf.
       3. Run the migrations:
          systemd-run --wait --pipe --collect -p User=doctor7 \
            -p EnvironmentFile=/etc/doctor7/api.env \
            /usr/lib/doctor7/run-task.sh migrate up
       4. systemctl start doctor7-api
  Web  1. Edit /etc/doctor7/web.vars.conf (name, Jitsi origin, certificate paths).
       2. a2ensite doctor7 && apache2ctl configtest && systemctl reload apache2
See docs/OPERATIONS.md.
EOF
