FROM golang:1.26-alpine AS audit
WORKDIR /src
COPY api/go.mod ./
COPY api/cmd/asset-audit ./cmd/asset-audit
RUN CGO_ENABLED=0 go build -trimpath -o /asset-audit ./cmd/asset-audit

FROM node:24-alpine
RUN apk add --no-cache unzip rsvg-convert
WORKDIR /app
COPY --from=audit /asset-audit /usr/local/bin/asset-audit
COPY scripts/prepare-assets.mjs ./scripts/prepare-assets.mjs
ENV SOURCE_ARCHIVE="/originals/Тестовое _ иллюстрации(2).zip" ASSET_OUTPUT_ROOT=/output ASSET_AUDIT_BIN=/usr/local/bin/asset-audit
CMD ["node", "scripts/prepare-assets.mjs"]
