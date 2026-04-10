# Stage 1: Build the Go plugin
FROM heroiclabs/nakama-pluginbuilder:3.38.0 AS builder
WORKDIR /backend
COPY backend/ .
RUN go build -buildmode=plugin -trimpath -o ./backend.so .

# Stage 2: Nakama server with the compiled plugin
FROM heroiclabs/nakama:3.38.0
COPY --from=builder /backend/backend.so /nakama/data/modules/backend.so

EXPOSE 7349 7350 7351
ENTRYPOINT ["/nakama/nakama"]
