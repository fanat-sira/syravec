#!/bin/sh
# managed by syravec setup-domain-https.sh
set -eu
case " ${RENEWED_DOMAINS:-} " in
  *' syravec.fanat-sira.art '*) nginx -t && systemctl reload nginx ;;
esac
