#!/usr/bin/env bash
# Host nginx only. Run once as root; routine application deploys need no sudo.
set -Eeuo pipefail
readonly domain=syravec.fanat-sira.art
readonly site=/etc/nginx/sites-available/syravec.fanat-sira.art
readonly enabled=/etc/nginx/sites-enabled/syravec.fanat-sira.art
readonly webroot=/var/lib/syravec-acme
readonly lineage=/etc/letsencrypt/live/syravec.fanat-sira.art
readonly hook=/etc/letsencrypt/renewal-hooks/deploy/50-syravec-nginx
readonly marker='# managed by syravec setup-domain-https.sh'
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fail() { echo "syravec HTTPS: $*" >&2; exit 1; }
[[ $(id -u) == 0 ]] || fail 'run this script as root on the deployment server'
for command in nginx certbot systemctl curl python3 openssl flock; do
  command -v "$command" > /dev/null || fail "missing $command; install it before setup (Ubuntu: apt-get install certbot curl openssl python3)"
done
exec 9>/run/lock/syravec-https.lock
flock -n 9 || fail 'another SyraVec HTTPS setup is already running'
systemctl is-active --quiet nginx || fail 'host nginx is not active; inspect the existing reverse proxy before setup'
[[ -d /etc/nginx/sites-available && -d /etc/nginx/sites-enabled ]] || fail 'expected Ubuntu nginx sites-available/sites-enabled layout'
for template in syravec.http.conf syravec.https.conf syravec-renew-hook.sh; do
  [[ -r "$repo/deploy/nginx/$template" ]] || fail "missing deploy/nginx/$template"
done
nginx -t
# Do not overwrite a pre-existing, independently managed site or renewal hook.
for owned in "$site" "$hook"; do
  if [[ -e "$owned" || -L "$owned" ]]; then
    [[ ! -L "$owned" && -f "$owned" ]] || fail "unexpected symlink or file type at $owned"
    grep -Fxq "$marker" "$owned" || fail "$owned is managed elsewhere; inspect it before changing this domain"
  fi
done
if [[ -e "$enabled" || -L "$enabled" ]]; then
  [[ -L "$enabled" && $(readlink -f "$enabled") == "$site" ]] || fail "$enabled already exists with another target"
fi
work=$(mktemp -d)
config_changed=0
committed=0
had_site=0
had_enabled=0
cleanup() {
  status=$?
  trap - EXIT
  if (( status != 0 && config_changed && !committed )); then
    echo 'restoring only the previous SyraVec nginx configuration' >&2
    if (( had_site )); then cp -p "$work/previous.conf" "$site"; else rm -f "$site"; fi
    if (( !had_enabled )); then rm -f "$enabled"; fi
    nginx -t && systemctl reload nginx || true
  fi
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT
nginx -T > "$work/effective.conf" 2> "$work/nginx-check.log"
# Check the effective includes and all server_name directives, including multiline ones.
python3 - "$work/effective.conf" "$site" "$enabled" "$domain" <<'PY'
import pathlib, re, sys
text = pathlib.Path(sys.argv[1]).read_text()
allowed = set(sys.argv[2:4])
domain = sys.argv[4]
if not re.search(r'\binclude\s+/etc/nginx/sites-enabled/\*\s*;', text):
    sys.exit('nginx does not include /etc/nginx/sites-enabled/*; inspect the current layout')
chunks = re.split(r'^# configuration file ([^\n]+):\s*$', text, flags=re.M)
for i in range(1, len(chunks), 2):
    path, content = chunks[i], chunks[i+1]
    content = re.sub(r'#[^\n]*', '', content)
    for names in re.findall(r'\bserver_name\s+([^;]+);', content):
        if domain in [name.strip("\"'").lower() for name in names.split()] and path not in allowed:
            sys.exit(f'{domain} already appears in {path}; inspect that configuration first')
PY
if [[ -e "$site" ]]; then cp -p "$site" "$work/previous.conf"; had_site=1; fi
if [[ -L "$enabled" ]]; then had_enabled=1; fi
# Backup the only host config this script may replace; no global nginx rewrite.
if (( had_site )); then
  backup=$(mktemp -d /var/backups/syravec-https.XXXXXXXX)
  cp -p "$site" "$backup/site.conf"
  echo "previous SyraVec configuration saved to $backup/site.conf"
fi
install -d -m 755 "$webroot/.well-known/acme-challenge"
config_changed=1
if [[ -r "$lineage/fullchain.pem" && -r "$lineage/privkey.pem" ]]; then
  openssl x509 -in "$lineage/fullchain.pem" -noout -checkhost "$domain"
  install -m 644 "$repo/deploy/nginx/syravec.https.conf" "$site"
else
  install -m 644 "$repo/deploy/nginx/syravec.http.conf" "$site"
fi
if (( !had_enabled )); then ln -s "$site" "$enabled"; fi
nginx -t
systemctl reload nginx
# Verify this hostname reaches this webroot before spending a production ACME request.
token="syravec-$(openssl rand -hex 16)"
printf '%s' "$token" > "$webroot/.well-known/acme-challenge/$token"
challenge=''
# A graceful reload returns before all old workers have drained; wait for this vhost.
for attempt in {1..10}; do
  challenge=$(curl --noproxy '*' --fail --silent --show-error --connect-timeout 3 --max-time 5 "http://$domain/.well-known/acme-challenge/$token") || true
  [[ "$challenge" == "$token" ]] && break
  sleep 1
done
rm -f "$webroot/.well-known/acme-challenge/$token"
[[ "$challenge" == "$token" ]] || fail 'HTTP challenge does not reach this webroot; check DNS A/AAAA, firewall and incoming port 80'
account=(--register-unsafely-without-email)
if [[ -n ${CERTBOT_EMAIL:-} ]]; then account=(--email "$CERTBOT_EMAIL"); fi
certbot certonly --non-interactive --agree-tos "${account[@]}" \
  --webroot --webroot-path "$webroot" --cert-name "$domain" -d "$domain" --keep-until-expiring
install -m 644 "$repo/deploy/nginx/syravec.https.conf" "$site"
nginx -t
systemctl reload nginx
committed=1
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
install -m 755 "$repo/deploy/nginx/syravec-renew-hook.sh" "$hook"
# Reuse the installed Certbot scheduler instead of creating a second global renew job.
if systemctl cat certbot.timer > /dev/null 2>&1; then
  timer=certbot.timer
elif systemctl cat snap.certbot.renew.timer > /dev/null 2>&1; then
  timer=snap.certbot.renew.timer
else
  fail 'no Certbot systemd timer found; HTTPS is configured, but automatic renewal still needs a scheduler'
fi
systemctl enable --now "$timer"
systemctl is-active --quiet "$timer"
certbot renew --cert-name "$domain" --dry-run
# A certificate may be configured before the private SVG library/application is deployed.
http_status=$(curl --noproxy '*' --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 10 --max-time 20 "https://$domain/api/v1/health")
echo "HTTPS configured: https://$domain -> 127.0.0.1:3000"
echo "renewal timer: $timer; renewal dry-run passed"
if [[ "$http_status" == 200 ]]; then
  echo 'public HTTPS health endpoint: 200'
else
  echo "public HTTPS health endpoint: $http_status (deploy the application/library or inspect its logs)"
fi
