#!/bin/bash
# Roll back the doctor7 packages to a previous release.
#
# Usage: rollback.sh <directory-with-previous-debs> [db-archive]
#
# Installs the previous packages (a downgrade). When a db archive is given, the
# database is restored from it. Do that when the new release changed the schema:
# older code can fail on a newer schema. The archive is the one that upgrade.sh
# made before it installed anything (BACKUP_DIR/db/db-<time>.sql.gz).
# Restoring the database discards every change made after that backup.
#
# DOCTOR7_HEALTH_URL overrides the address checked after the restart.
set -euo pipefail

die() {
  printf 'rollback: %s\n' "$*" >&2
  exit 1
}

[ $# -ge 1 ] && [ $# -le 2 ] || die "usage: rollback.sh <directory-with-previous-debs> [db-archive]"
DIR=$1
DB_ARCHIVE=${2:-}
HEALTH_URL=${DOCTOR7_HEALTH_URL:-http://127.0.0.1:3000/readyz}

[ "$(id -u)" -eq 0 ] || die "run as root."
[ -d "$DIR" ] || die "directory not found: $DIR"
[ -z "$DB_ARCHIVE" ] || [ -f "$DB_ARCHIVE" ] || die "database archive not found: $DB_ARCHIVE"

shopt -s nullglob
api_debs=("$DIR"/doctor7-api_*_all.deb)
web_debs=("$DIR"/doctor7-web_*_all.deb)
shopt -u nullglob
[ "${#api_debs[@]}" -le 1 ] && [ "${#web_debs[@]}" -le 1 ] || die "more than one version of a package in $DIR."
debs=()
[ "${#api_debs[@]}" -eq 1 ] && debs+=("$(readlink -f "${api_debs[0]}")")
[ "${#web_debs[@]}" -eq 1 ] && debs+=("$(readlink -f "${web_debs[0]}")")
[ "${#debs[@]}" -gt 0 ] || die "no doctor7 package found in $DIR."

printf 'rollback: this installs these packages over the current ones:\n'
printf '  %s\n' "${debs[@]}"
if [ -n "$DB_ARCHIVE" ]; then
  printf 'rollback: and restores the database from %s\n' "$DB_ARCHIVE"
fi
printf 'Type "rollback" to continue: '
read -r answer
[ "$answer" = "rollback" ] || die "cancelled."

apt-get install -y --allow-downgrades "${debs[@]}"

if [ -n "$DB_ARCHIVE" ]; then
  doctor7-restore --yes db "$DB_ARCHIVE"
fi

if [ "${#api_debs[@]}" -eq 1 ]; then
  systemctl restart doctor7-api.service
  if command -v curl >/dev/null 2>&1; then
    ok=no
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
        ok=yes
        break
      fi
      sleep 2
    done
    [ "$ok" = yes ] || die "the API did not answer at $HEALTH_URL. Check: journalctl -u doctor7-api"
  else
    printf 'rollback: warning: curl was not found. Check %s by hand.\n' "$HEALTH_URL" >&2
  fi
fi

printf 'rollback: done.\n'
