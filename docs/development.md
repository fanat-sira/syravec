# Development

The normal installation uses Docker Compose; see the [quick start](../README.md#quick-start). Working directly on the source requires Go 1.23+ and Node.js 24+. Asset preparation outside Docker also requires unzip and librsvg's `rsvg-convert`.

## Local processes

With `originals/assets.zip` available, prepare the library and install frontend dependencies:

```bash
node scripts/prepare-assets.mjs
npm ci --prefix web
```

Run these in separate terminals:

```bash
cd api && go run .
```

```bash
cd web && npm run dev
```

Vite proxies `/api` to `127.0.0.1:8080`. Both Compose and the Go entry point read the supported configuration from the environment; the local Go entry point also loads missing settings from `.env` without replacing existing environment values.

## Checks

```bash
cd api
go test -race ./...
go vet ./...
```

```bash
cd web
npm test
npm run build
npm run format:check
```

Browser scenarios additionally need the API and Vite running. Use `CHROME_PATH` to select a Chrome executable, then run `npm run test:e2e` from `web/`.

For an isolated browser fixture without the private originals, `scripts/create-test-assets.mjs /tmp/syravec-test-public` creates synthetic vectors. Point the API's `CATALOG_PATH` to that directory's `assets/manifest.json` and set Vite's `SYRAVEC_TEST_PUBLIC_DIR` to `/tmp/syravec-test-public`. These fixtures are for checks, not the product library.

CI uses mock model responses and synthetic geometry. It does not establish the artistic quality of a live model on the original illustrations. Live provider calls require an explicitly configured key and consume quota.
