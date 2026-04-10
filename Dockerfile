# Stage 1: Build the Go plugin
FROM heroiclabs/nakama-pluginbuilder:3.38.0 AS builder
WORKDIR /backend
COPY backend/ .
RUN go build -buildmode=plugin -trimpath -o ./backend.so .

# Stage 2: Nakama server with the compiled plugin
FROM heroiclabs/nakama:3.38.0
COPY --from=builder /backend/backend.so /nakama/data/modules/backend.so

EXPOSE 7350
# Strip postgres:// prefix that Render provides but Nakama doesn't accept
CMD ["/bin/sh", "-c", "/nakama/nakama --name nakama1 --database.address \"$(echo $DATABASE_URL | sed 's|^postgresql://||;s|^postgres://||')\" --socket.port \"${PORT:-7350}\""]
