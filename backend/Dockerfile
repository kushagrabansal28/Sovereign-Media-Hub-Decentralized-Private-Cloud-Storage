FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM alpine:3.21
RUN apk add --no-cache ca-certificates \
 && adduser -D -u 10001 smh \
 && mkdir /data && chown smh /data
USER smh
COPY --from=build /out/server /usr/local/bin/server
ENV PORT=8080 DATA_DIR=/data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=4s --start-period=5s --retries=3 CMD ["server", "-healthcheck"]
ENTRYPOINT ["server"]
