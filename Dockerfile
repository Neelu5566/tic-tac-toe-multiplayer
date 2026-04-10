# Stage 1: Build the Go plugin
FROM heroiclabs/nakama-pluginbuilder:3.38.0 AS builder
WORKDIR /backend
COPY backend/ .
RUN go build -buildmode=plugin -trimpath -o ./backend.so .

# Stage 2: Nakama server with the compiled plugin
FROM heroiclabs/nakama:3.38.0
COPY --from=builder /backend/backend.so /nakama/data/modules/backend.so

# Write startup script inside the image (avoids Windows CRLF issues)
RUN printf '#!/bin/sh\nset -e\nDB=$(echo "$DATABASE_URL" | sed "s|^postgresql://||;s|^postgres://||")\n/nakama/nakama migrate up --database.address "$DB"\nexec /nakama/nakama --name nakama1 --database.address "$DB" --socket.port "${PORT:-7350}"\n' > /start.sh \
    && chmod +x /start.sh

EXPOSE 7350
ENTRYPOINT ["/start.sh"]

