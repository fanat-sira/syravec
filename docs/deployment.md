# Deployment

The supplied workflow publishes three images (`api`, `web`, and `assets`) to GitHub Container Registry and deploys through a self-hosted Linux x64 runner. Its configured directory is `/opt/syravec` and its Compose project name is `syravec`.

## Prepare the host

Install Docker Engine and the Compose plugin. The runner user needs Docker access and write access to the application directory. The following assumes that user is named `gha-runner`:

```bash
sudo install -d -m 750 -o gha-runner -g gha-runner \
  /opt/syravec /opt/syravec/originals
```

Create `/opt/syravec/.env` from [`.env.example`](../.env.example), set the provider key and model, and make the file readable by the runner only. Place both private illustration archives at `/opt/syravec/originals/assets.zip` (large, original `(2)`) and `/opt/syravec/originals/assets-small.zip` (small, original `(3)`). Their original filenames are also accepted. The deployment preflight rejects a missing set before stopping existing services.

The deployment does not copy a developer's `.env`, replace the server's credentials, or deliver the private archives. Configure GitHub's `production` environment and the runner for the repository. For a fork or another host, review the runner selection, registry path, application directory, and nginx hostname before enabling deployment.

## Release flow

[The checks workflow](../.github/workflows/check.yml) runs the configured API, web, browser, and container checks on pushes and pull requests. A successful push to `main` publishes images tagged with the commit SHA and `latest`, then calls [the deployment workflow](../.github/workflows/deploy.yml).

[`deploy.sh`](../scripts/deploy.sh) pulls the selected images, prepares the private library, and waits for service health. It records the successful SHA in `.deployed-tag`. If the new services fail their health wait, it attempts to restore that previous image tag. It does not roll back persistent data or the deployment configuration.

A running `main` workflow is not automatically cancelled by a later push; later runs wait in the workflow concurrency group. The deployment job also runs serially.

The deploy workflow can be dispatched manually with a previously published **full commit SHA**. Registry access uses the workflow's `GITHUB_TOKEN`; no SSH key is required.

## Domain and HTTPS

The reference deployment uses **syravec.fanat-sira.art**, with host nginx forwarding to **127.0.0.1:3000**. SyraVec's containers do not publish host ports 80 or 443.

The HTTPS setup script targets Ubuntu's `sites-available` / `sites-enabled` nginx layout. It requires nginx, Certbot, curl, Python 3, OpenSSL, systemd, and flock on the host. DNS must point to the host and inbound ports 80/443 must be reachable.

After the repository's deployment files have been installed in `/opt/syravec`, run the one-time setup as root:

```bash
sudo bash /opt/syravec/scripts/setup-domain-https.sh
```

An optional `CERTBOT_EMAIL` supplies the certificate account email. The script manages only the exact SyraVec hostname, validates nginx before reload, uses a webroot challenge, and leaves other virtual hosts intact. It enables the existing Certbot timer and installs a renewal hook for this certificate. Ordinary application deployment needs no root access and does not run Certbot.

```bash
curl -I http://syravec.fanat-sira.art
curl -fsS https://syravec.fanat-sira.art/api/v1/health
systemctl list-timers --all
```

If your host uses another proxy, hostname, or nginx layout, adapt the files under [`deploy/nginx/`](../deploy/nginx/) rather than running the setup unchanged.

## Persistent data and limits

- `assets`: prepared SVG library, mounted read-only by API and web.
- `api-data`: main-model usage counters, including the sliding per-IP and global windows.
- `/opt/syravec/.env`: deployment configuration and provider credentials.
- `/opt/syravec/originals/assets.zip` and `assets-small.zip`: private independent source libraries.

Keep the same Compose project name during updates so it uses the same named volumes. Do not use `docker compose down -v` for a normal deployment. Browser projects are stored on each user's device, not in server volumes.

The API does not publish a host port. Internal nginx replaces `X-Real-IP` after resolving the last `X-Forwarded-For` from the trusted host proxy. The reference trust list covers loopback and the standard `172.16.0.0/12` Docker bridge range. Adjust `set_real_ip_from` in [`web/nginx.conf`](../web/nginx.conf) if your bridge uses another subnet; do not expose the API directly with proxy trust enabled.

## Operations

```bash
cd /opt/syravec
sudo docker compose ps -a
sudo docker compose logs --tail=100 assets api web
```

`assets` exiting successfully is expected. If preparation fails, inspect its log and both private archives before restarting. A healthy API alone does not confirm browser rendering or the quality of live model output.

Updating the main-model limits in `.env` takes effect when the API is recreated. Existing calls remain counted when limits are lowered. Quota errors include `Retry-After`; manual editing and vector export stay available.
