#!/usr/bin/env bash
#
# Build (and optionally push) the three custom OASM images consumed by the
# oasm-docker deployment: console, api, worker.
#
# Why this script exists: the worker image must be built from the REPO ROOT
# context with `-f worker/Dockerfile`, because worker/go.mod now has a local
# `replace` pointing at ../grpc-client/go. Building it from ./worker (the old
# context) fails to resolve that module. The api and console images still
# build from their own subdirectories. This script encodes those contexts so
# nobody has to remember the difference.
#
# Usage:
#   scripts/build-images.sh                 # build all three, no push
#   REGISTRY=sil3ntcor3 TAG=latest scripts/build-images.sh --push
#   scripts/build-images.sh --push worker   # build+push only the worker
#
# The oasm-docker compose pins `platform: linux/amd64`, so images are built
# for linux/amd64 by default. Override with PLATFORM=.
set -euo pipefail

# Registry namespace and tag the oasm-docker deployment pulls.
REGISTRY="${REGISTRY:-sil3ntcor3}"
TAG="${TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"

# Resolve the repo root regardless of where the script is invoked from.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PUSH=0
TARGETS=()
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    console|api|worker) TARGETS+=("$arg") ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done
# Default to all three when no explicit target is given.
if [ "${#TARGETS[@]}" -eq 0 ]; then
  TARGETS=(console api worker)
fi

# image name for a given component
image_for() { echo "${REGISTRY}/myoasm-$1:${TAG}"; }

build_one() {
  local name="$1" context dockerfile img
  img="$(image_for "$name")"
  case "$name" in
    console) context="./console"        ; dockerfile="./console/Dockerfile" ;;
    api)     context="./core-api"        ; dockerfile="./core-api/Dockerfile" ;;
    # Worker: root context + worker/Dockerfile (local replace of grpc-client/go).
    worker)  context="."                 ; dockerfile="./worker/Dockerfile" ;;
    *) echo "Unknown target: $name" >&2; return 2 ;;
  esac

  echo ">> Building ${img} (context=${context}, platform=${PLATFORM})"
  docker build --platform "${PLATFORM}" -f "${dockerfile}" -t "${img}" "${context}"

  if [ "${PUSH}" -eq 1 ]; then
    echo ">> Pushing ${img}"
    docker push "${img}"
  fi
}

for t in "${TARGETS[@]}"; do
  build_one "$t"
done

echo "Done. Built: ${TARGETS[*]} (tag=${TAG}, registry=${REGISTRY})"
if [ "${PUSH}" -eq 0 ]; then
  echo "Re-run with --push to publish, then redeploy from oasm-docker (make update)."
fi
