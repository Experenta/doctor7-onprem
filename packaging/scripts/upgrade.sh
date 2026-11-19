#!/bin/bash
# Upgrade the doctor7 packages: back up, install, migrate, check.
#
# Usage: upgrade.sh <directory-with-new-debs>
#
# Steps: (1) back up all layers, (2) install the new packages, (3) run the
# database migrations, (4) restart the API and check /readyz.
# The script never rolls back by itself. When a step fails it prints the
# rollback command. Keep the previous release directory until the upgrade is
# accepted: rollback.sh needs its .deb files.
#
# DOCTOR7_HEALTH_URL overrides the address checked after the restart.
set -euo pipefail

die() {
  printf 'upgrade: %s\n' "$*" >&2
  exit 1
}

[ $# -eq 1 ] || die "usage: upgrade.sh <directory-with-new-debs>"
DIR=$1
HEALTH_URL=${DOCTOR7_HEALTH_URL:-http://127.0.0.1:3000/readyz}

[ "$(id -u)" -eq 0 ] || die "run as root."
[ -d "$DIR" ] || die "directory not found: $DIR"
command -v apt-get >/dev/null 2>&1 || die "apt-get was not found."

shopt -s nullglob
api_debs=("$DIR"/doctor7-api_*_all.deb)
web_debs=("$DIR"/doctor7-web_*_all.deb)
shopt -u nullglob
[ "${#api_debs[@]}" -le 1 ] && [ "${#web_debs[@]}" -le 1 ] || die "more than one version of a package in $DIR."
debs=()
[ "${#api_debs[@]}" -eq 1 ] && debs+=("$(readlink -f "${api_debs[0]}")")
[ "${#web_debs[@]}" -eq 1 ] && debs+=("$(readlink -f "${web_debs[0]}")")
[ "${#debs[@]}" -gt 0 ] || die "no doctor7 package found in $DIR."

installed_versions() {
  dpkg-query -W -f='${Package} ${Version}\n' doctor7-api doctor7-web 2>/dev/null || true
}

printf 'upgrade: installed before:\n%s\n' "$(installed_versions)"

printf 'upgrade: step 1 of 4: backup\n'
doctor7-backup all || die "the backup failed. Nothing was changed."

printf 'upgrade: step 2 of 4: install\n'
apt-get install -y "${debs[@]}" || die "the install failed. Roll back with: rollback.sh <previous-release-directory>"

if [ "${#api_debs[@]}" -eq 1 ]; then
  printf 'upgrade: step 3 of 4: migrations\n'
  systemd-run --wait --pipe --collect -p User=doctor7 \
    -p EnvironmentFile=/etc/doctor7/api.env \
    /usr/lib/doctor7/run-task.sh migrate up \
    || die "the migrations failed. Roll back with: rollback.sh <previous-release-directory> <db-archive>"

  printf 'upgrade: step 4 of 4: restart and health check\n'
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
    [ "$ok" = yes ] || die "the API did not answer at $HEALTH_URL. Check: journalctl -u doctor7-api. Roll back with: rollback.sh <previous-release-directory> <db-archive>"
  else
    printf 'upgrade: warning: curl was not found. Check %s by hand.\n' "$HEALTH_URL" >&2
  fi
fi

printf 'upgrade: installed now:\n%s\n' "$(installed_versions)"
printf 'upgrade: done. The pre-upgrade archives are in the backup directory (see /etc/doctor7/backup.conf).\n'
