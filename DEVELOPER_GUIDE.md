# Developer Guide for Open Attack Surface Management (OASM)

This guide provides detailed instructions for setting up your local development environment, running the services, and contributing to the OASM project.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Initialize Developer Environment](#initialize-developer-environment)
- [Running Services](#running-services)
  - [All Services with Task](#all-services-with-task)
  - [Core API](#core-api)
  - [Console (Web Interface)](#console-web-interface)
  - [Workers](#workers)
- [Code Generation](#code-generation)
  - [API Client (orval)](#api-client-orval)
  - [gRPC Stubs (protobuf)](#grpc-stubs-protobuf)
- [Database Setup](#database-setup)
- [Database Migration](#database-migration)
- [Development Conventions](#development-conventions)
  - [Code Style](#code-style)
  - [Testing](#testing)
  - [Commit Messages](#commit-messages)
- [Using Docker Compose](#using-docker-compose)
- [Contributing](#contributing)

## Prerequisites

Before you begin, ensure you have the following installed:

- **Task (taskfile)** — [Installation Guide](https://taskfile.dev/#/installation)
- **Node.js v22+** — [Installation Guide](https://nodejs.org/en/download/package-manager) (CI builds and tests on Node.js 22)
- **Go 1.26+** — [Installation Guide](https://go.dev/doc/install) (required for the workers and gRPC code generation)
- **PostgreSQL v17** with the `pgvector` extension (or use the Docker Compose database)
- **Redis** (or use the Docker Compose service)
- **Docker & Docker Compose** (recommended for running the database, Redis, and the full stack)

## Project Structure

The project is a monorepo organized into three services plus shared gRPC stubs:

```
open-asm/
├── core-api/             # NestJS 11 API server (TypeScript)
│   ├── src/                 # Source code (modules, common, database, mcp, proto, services)
│   ├── test/                # e2e tests
│   ├── example.env          # Environment template
│   ├── taskfile.yml
│   └── package.json
├── console/              # React 19 web interface (TypeScript, Vite, Tailwind v4)
│   ├── src/                 # Components, pages, routes, services, hooks
│   ├── e2e/                 # Playwright end-to-end tests
│   ├── public/              # Static assets
│   ├── orval.config.ts      # API client generation config
│   ├── taskfile.yml
│   └── package.json
├── worker/               # Go-based distributed scanning workers
│   ├── cmd/cli/             # CLI-mode entry point (flag driven)
│   ├── cmd/app/             # App-mode entry point (env driven)
│   ├── internal/            # Worker business logic (cli, config, worker)
│   ├── scripts/             # install.sh / install.ps1 installers
│   ├── taskfile.yml
│   └── go.mod
├── grpc-client/          # Generated gRPC stubs (Go + TypeScript)
├── .open-api/            # Auto-generated OpenAPI spec (gitignored)
├── docker-compose.yml    # Container orchestration
├── taskfile.yml          # Root task automation
├── AGENTS.md             # Agent / contributor quick reference
└── README.md
```

> The root `package.json` is an npm workspace for `core-api` and `console` only. The `worker` uses the Go toolchain separately.

## Initialize Developer Environment

To set up your local development environment, run the following command:

```bash
task init
```

This command will:

- Install the root dev dependency (`husky`) and set up git hooks.
- Install `core-api` and `console` dependencies (`npm install`).
- Install `worker` Go module dependencies (`go mod tidy`).

Copy the example environment files for each service before running anything (they are gitignored):

```bash
cp core-api/example.env core-api/.env
cp console/example.env  console/.env
cp worker/.example.env  worker/.env
```

After initialization, start all services using `task dev` or run them individually as described below.

## Running Services

### All Services with Task

To start the API and Console development servers (with hot reload) simultaneously, run from the root directory:

```bash
task dev
```

The API listens on port `6276` and exposes a gRPC server on port `16276`.

### Core API

From the repository root:

```bash
task api:dev      # Start the NestJS server in watch mode
task api:build    # Production build
task api:lint     # Lint (with --fix)
task api:test     # Run Jest unit tests
```

### Console (Web Interface)

```bash
task console:dev    # Start the Vite dev server
task console:build  # Production build
task console:lint   # Lint
task console:test   # Run Vitest tests
```

### Workers

The workers are Go binaries with two run modes:

- **CLI mode** (`cmd/cli`) — configured via command-line flags.
- **App mode** (`cmd/app`) — configured via `WORKER_*` environment variables.

Run a single worker locally (CLI mode):

```bash
task worker:dev
```

Run a worker in app mode:

```bash
task worker:dev-app
```

Scale the number of local worker instances and override settings:

```bash
task worker:dev replicas=3 maxJobs=10
```

A worker requires an API key that matches the one configured in `core-api`. Provide it via `WORKER_API_KEY` in `worker/.env`, or pass `apiKey=<key>` to the task. Other relevant worker variables:

| Variable                 | Default      | Description                         |
| ------------------------ | ------------ | ----------------------------------- |
| `WORKER_API_KEY`         | _(required)_ | Worker authentication key           |
| `WORKER_MAX_CONCURRENCY` | `10`         | Max concurrent scanning tasks       |
| `WORKER_GRPC_HOST`       | `localhost`  | core-api gRPC host                  |
| `WORKER_GRPC_PORT`       | `16276`      | core-api gRPC port                  |
| `WORKER_NETWORK`         | _(empty)_    | Optional network label              |
| `WORKER_TOOL_PATH`       | `oasm-tools` | Directory for downloaded scan tools |

## Code Generation

### API Client (orval)

The console's typed API hooks are generated from the OpenAPI spec (`.open-api/open-api.json`). After **any** change to the API contract, regenerate the client:

```bash
task gen-api
```

This writes generated TanStack Query hooks and types to `console/src/services/apis/gen/`. **Do not edit generated files manually.**

### gRPC Stubs (protobuf)

The gRPC stubs shared between `core-api` and the Go `worker` are generated from the `.proto` files in `core-api/src/proto/`:

```bash
task proto
```

This regenerates both the Go and TypeScript clients into `grpc-client/`.

## Database Setup

When using Docker Compose, PostgreSQL (with `pgvector`) and Redis are started automatically. The database connection details are configured in `core-api/.env`.

If you prefer to use your own PostgreSQL instance, update `core-api/.env` accordingly. The TypeORM data source is defined in `core-api/src/database/database-config.ts`.

## Database Migration

Database migrations are managed with TypeORM via the taskfile.

### Generate a new migration

```bash
task migration:generate MIGRATION_NAME=AddUserTable
```

This creates a new migration file in `core-api/src/database/migrations/`.

### Run all pending migrations

```bash
task migration:run
```

### Revert the last migration

```bash
task migration:revert
```

> **Note:** `migration:revert` only rolls back one migration at a time. Repeat as needed.

### Running migrations with Docker Compose

When running the full stack, a dedicated `migration` service runs all pending migrations before `core-api` starts. To run it manually:

```bash
docker compose run --rm migration
```

## Development Conventions

### Code Style

- **Core API (NestJS):** ESLint (strict, type-checked) + Prettier. Run `task api:lint`. Notable rules: no `console.log`, no floating/misused promises, consistent type imports.
- **Console (React):** ESLint + Prettier with React hooks rules. Run `task console:lint`.
- **Workers (Go):** Standard Go conventions. Format with `task worker:format` (`go fmt`), lint with `task worker:lint` (`go vet`), and verify compilation with `task worker:check`.

Run linting for both Node services at once:

```bash
task lint
```

### Testing

- **Core API:** Jest. `*.spec.ts` files live alongside source.
  - `task api:test` — unit tests
  - `cd core-api && npm run test:watch` — watch mode
  - `cd core-api && npm run test:e2e` — end-to-end tests
- **Console:** Vitest for unit tests and Playwright for e2e.
  - `cd console && npm run test` — unit tests
  - `cd console && npm run e2e` — Playwright e2e tests
  - Note: console tests are not included in the root `task test`; run them explicitly.
- **Workers:** `task worker:test` (`go test ./...`).

Run the API test suite from the root:

```bash
task test
```

### Commit Messages

Commit messages are validated via a Husky `commit-msg` hook and must follow Conventional Commits, e.g.:

```
feat(console): add asset filter
fix(core-api): handle missing workspace id
```

Allowed types include `feat`, `fix`, `hot-fix`, `perf`, `chore`, `docs`, `style`, `refactor`, `test`, and `ci`.

## Using Docker Compose

To build and run the entire stack (Console, Core API, 3 workers, PostgreSQL, Redis, geo-ip proxy, and object storage):

```bash
task docker-compose
```

This uses `docker-compose.yml` and the `core-api/.env` environment file. The console is served on port `3000` and the API on `6276`.

## Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/amazing-feature`.
3. Make your changes and commit them using Conventional Commits: `git commit -m 'feat: add amazing feature'`.
4. Push to the branch: `git push origin feature/amazing-feature`.
5. Open a Pull Request.

Please ensure your code passes linting and tests, and that you have regenerated any affected API clients (`task gen-api`) or gRPC stubs (`task proto`) before submitting a PR.
