#!/bin/sh
set -eu

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

require_credential() {
  name="$1"
  value="$2"
  minimum_length="$3"

  if [ -z "$value" ]; then
    fail "$name is required"
  fi

  case "$value" in
    postgres | password | rustfsadmin | rustfssecret | change_me | changeme | replace-with-*)
      fail "$name must not use a shipped or placeholder credential"
      ;;
  esac

  if [ "${#value}" -lt "$minimum_length" ]; then
    fail "$name must be at least $minimum_length characters"
  fi
}

require_credential 'POSTGRES_PASSWORD' "${POSTGRES_PASSWORD:-}" 32
require_credential 'REDIS_PASSWORD' "${REDIS_PASSWORD:-}" 32
require_credential 'RUSTFS_ACCESS_KEY' "${RUSTFS_ACCESS_KEY:-}" 16
require_credential 'RUSTFS_SECRET_KEY' "${RUSTFS_SECRET_KEY:-}" 32
require_credential 'BETTER_AUTH_SECRET' "${BETTER_AUTH_SECRET:-}" 32

case "$REDIS_PASSWORD" in
  *[!A-Za-z0-9._~-]*)
    fail 'REDIS_PASSWORD must contain only URI-safe letters, digits, dot, underscore, tilde, or hyphen'
    ;;
esac

printf '%s\n' 'Compose credentials accepted'
