# Stage 1: Build
# Build context is the REPO ROOT (see docker-compose.yml): worker/go.mod
# replaces github.com/sil3ntcor3/open-asm/grpc-client/go with the local
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

# Stage 2: Nuclei template seed
#
# A fresh worker must be scan-ready without first pulling ~14k template files
# from GitHub, so the pinned template release is baked in here and activated by
# the worker when its tool cache holds no template set yet. Administrator
# approved update directives still move workers to newer releases at runtime.
# These pins are kept in lockstep with scripts/tool-versions.json, asserted by
# scripts/update-tool-artifacts.test.sh.
FROM debian:bookworm-slim AS templates

ARG NUCLEI_TEMPLATES_VERSION=10.4.7
ARG NUCLEI_TEMPLATES_SHA256=e1e2b1acf375bb80c558c968f87ea8639de1914cd47099351b54b06afa8643c4

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    curl --fail --location --silent --show-error --retry 3 \
      "https://github.com/projectdiscovery/nuclei-templates/archive/refs/tags/v${NUCLEI_TEMPLATES_VERSION}.tar.gz" \
      --output /tmp/nuclei-templates.tar.gz; \
    echo "${NUCLEI_TEMPLATES_SHA256}  /tmp/nuclei-templates.tar.gz" | sha256sum -c -; \
    mkdir -p /opt/oasm/nuclei-templates; \
    tar -xzf /tmp/nuclei-templates.tar.gz -C /opt/oasm/nuclei-templates --strip-components=1; \
    rm /tmp/nuclei-templates.tar.gz; \
    rm -rf /opt/oasm/nuclei-templates/.github \
           /opt/oasm/nuclei-templates/.review-bot \
           /opt/oasm/nuclei-templates/.pre-commit-config.yml \
           /opt/oasm/nuclei-templates/.yamllint; \
    find /opt/oasm/nuclei-templates -type l -delete; \
    printf '%s\n' "${NUCLEI_TEMPLATES_VERSION}" > /opt/oasm/nuclei-templates/.oasm-seed-version

# Stage 3: Runtime
FROM debian:bookworm-slim

WORKDIR /app

# Install ca-certificates for TLS, bash, chromium for browser tasks, libpcap for
# naabu, and nmap for -sV service discovery (protocol identification per open
# port, used to gate web-only steps and enrich the asset inventory).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    bash \
    chromium \
    libpcap0.8 \
    nmap \
    curl \
    iputils-ping \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

# Create tool directory
RUN mkdir -p /app/oasm-tools

# Copy binary from builder
COPY --from=builder /src/worker/oasm-worker .

# Baked, read-only template seed. The worker copies it into its writable tool
# cache on first start; it is never scanned from or written to in place.
COPY --from=templates /opt/oasm/nuclei-templates /opt/oasm/nuclei-templates

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
#   WORKER_NUCLEI_TEMPLATE_SEED - Baked template seed (empty disables seeding)
ENV WORKER_MAX_CONCURRENCY=10
ENV WORKER_GRPC_HOST=localhost
ENV WORKER_GRPC_PORT=16276
ENV WORKER_TOOL_PATH=oasm-tools
ENV WORKER_NUCLEI_TEMPLATE_SEED=/opt/oasm/nuclei-templates

# Metadata
LABEL org.opencontainers.image.title="OASM Worker"
LABEL org.opencontainers.image.description="Attack Surface Management worker agent"
LABEL org.opencontainers.image.vendor="OASM Platform"

# Entrypoint
ENTRYPOINT ["/app/oasm-worker"]
