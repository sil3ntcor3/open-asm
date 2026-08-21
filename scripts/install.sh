#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${script_directory}/.." && pwd)"
compose_env_file="${repository_root}/core-api/.env"
build_images=true

usage() {
  printf '%s\n' 'Usage: ./scripts/install.sh [--no-build]'
  printf '%s\n' '  --no-build  Use previously pulled or built container images.'
}

case "${1:-}" in
  '') ;;
  --no-build) build_images=false ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if [[ $# -gt 1 ]]; then
  usage >&2
  exit 2
fi

for environment_file in core-api/.env console/.env worker/.env; do
  if [[ ! -f "${repository_root}/${environment_file}" ]]; then
    printf 'Missing %s. Copy its example file and configure it before installation.\n' \
      "${environment_file}" >&2
    exit 1
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  printf '%s\n' 'Docker is required to install Open-ASM.' >&2
  exit 1
fi

compose() {
  docker compose --env-file "${compose_env_file}" "$@"
}

cd "${repository_root}"
compose version >/dev/null
compose config --quiet

if [[ "${build_images}" == true ]]; then
  printf '%s\n' 'Building Open-ASM images...'
  compose build core-api console oasm-worker
fi

printf '%s\n' 'Starting the database and applying migrations...'
compose up -d --wait postgres redis
compose run --rm --no-deps migration

IFS= read -r -p 'Administrator email: ' admin_email
IFS= read -r -s -p 'Administrator password: ' admin_password
printf '\n'
IFS= read -r -s -p 'Confirm administrator password: ' admin_password_confirmation
printf '\n'

if [[ -z "${admin_email}" ]]; then
  printf '%s\n' 'Administrator email is required.' >&2
  exit 1
fi
if [[ "${admin_password}" != "${admin_password_confirmation}" ]]; then
  printf '%s\n' 'Administrator passwords do not match.' >&2
  exit 1
fi
if (( ${#admin_password} < 8 || ${#admin_password} > 128 )); then
  printf '%s\n' 'Administrator password must be between 8 and 128 characters.' >&2
  exit 1
fi

printf '%s\n' 'Creating the administrator account...'
printf '%s\n%s\n' "${admin_email}" "${admin_password}" | \
  compose --profile setup run --rm -T --no-deps admin-provisioner
unset admin_password admin_password_confirmation

printf '%s\n' 'Starting Open-ASM...'
compose up -d
printf '%s\n' 'Open-ASM is ready. Sign in at http://localhost:3000.'
