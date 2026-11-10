FROM golang:1.26-alpine AS build
WORKDIR /app
COPY api/go.mod ./
COPY api/*.go ./
RUN CGO_ENABLED=0 go build -trimpath -o /server .
FROM alpine:3.23
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
WORKDIR /app
RUN mkdir -p /app/data && chown app:app /app/data
COPY --from=build /server /app/server
ENV LISTEN_ADDR=:8080 CATALOG_PATH=/app/assets/manifest.json
USER app
EXPOSE 8080
CMD ["/app/server"]
