# Stage 1: Build
# Build context is the REPO ROOT (see docker-compose.yml): worker/go.mod
# replaces github.com/oasm-platform/open-asm/grpc-client/go with the local
# ../grpc-client/go, so both directories must be inside the context.
FROM golang:1.26-alpine AS builder

WORKDIR /src/worker

# Install git for go mod download
RUN apk add --no-cache git ca-certificates

# Copy both locally-replaced modules and go mod files first. Go resolves local
# replacements during `go mod download`, before the remaining worker source is
# copied into the image.
COPY grpc-client/go /src/grpc-client/go
COPY worker/third_party/oasm-sdk-go ./third_party/oasm-sdk-go
COPY worker/go.mod worker/go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY worker/ .

# Build static binary with optimizations from the new APP entrypoint
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags='-w -s -extldflags "-static"' \
    -o oasm-worker ./cmd/app

# Stage 2: Runtime
FROM debian:bookworm-slim

WORKDIR /app

# Install ca-certificates for TLS, bash, chromium for browser tasks, and libpcap for naabu
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    bash \
    chromium \
    libpcap0.8 \
    curl \
    iputils-ping \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

# Create tool directory
RUN mkdir -p /app/oasm-tools

# Copy binary from builder
COPY --from=builder /src/worker/oasm-worker .

# Create non-root user for security
RUN groupadd -g 1000 worker && \
    useradd -u 1000 -g worker -s /bin/bash -m worker

# Change ownership of app directory
RUN chown -R worker:worker /app

USER worker

# Default environment variables (override at runtime with -e)
# Required:
#   WORKER_API_KEY - Your worker authentication key
# Optional:
#   WORKER_MAX_CONCURRENCY - Max concurrent tasks (default: 10)
#   WORKER_GRPC_HOST - gRPC server host (default: localhost)
#   WORKER_GRPC_PORT - gRPC server port (default: 16276)
#   WORKER_TOOL_PATH - Tool path (default: oasm-tools)
ENV WORKER_MAX_CONCURRENCY=10
ENV WORKER_GRPC_HOST=localhost
ENV WORKER_GRPC_PORT=16276
ENV WORKER_TOOL_PATH=oasm-tools

# Metadata
LABEL org.opencontainers.image.title="OASM Worker"
LABEL org.opencontainers.image.description="Attack Surface Management worker agent"
LABEL org.opencontainers.image.vendor="OASM Platform"

# Entrypoint
ENTRYPOINT ["/app/oasm-worker"]
