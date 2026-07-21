#!/usr/bin/env bash
set -euo pipefail

version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: $0 <semantic-version>" >&2
  exit 1
fi

script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="${OASM_REPOSITORY_ROOT:-$(cd "$script_root/.." && pwd)}"
release_base_url="${OASM_NUCLEI_RELEASE_BASE_URL:-https://github.com/projectdiscovery/nuclei/releases/download/v$version}"
archive_root="$repository_root/core-api/public/archived"
temporary_root="$(mktemp -d)"
trap 'rm -rf "$temporary_root"' EXIT

checksum_file="nuclei_${version}_checksums.txt"
curl --fail --location --silent --show-error --retry 3 \
  "$release_base_url/$checksum_file" \
  --output "$temporary_root/$checksum_file"

specifications=(
  "linux_amd64|linux_amd64|nuclei"
  "linux_arm64|linux_arm64|nuclei"
  "macos_amd64|macOS_amd64|nuclei"
  "windows_amd64|windows_amd64|nuclei.exe"
)

manifest_entries=()
for specification in "${specifications[@]}"; do
  IFS='|' read -r destination platform binary_name <<< "$specification"
  archive_name="nuclei_${version}_${platform}.zip"
  archive_path="$temporary_root/$archive_name"

  curl --fail --location --silent --show-error --retry 3 \
    "$release_base_url/$archive_name" \
    --output "$archive_path"

  expected_checksum="$(awk -v archive="$archive_name" '$2 == archive { print $1 }' "$temporary_root/$checksum_file")"
  if [[ -z "$expected_checksum" ]]; then
    echo "official checksum missing for $archive_name" >&2
    exit 1
  fi
  actual_checksum="$(shasum -a 256 "$archive_path" | awk '{ print $1 }')"
  if [[ "$actual_checksum" != "$expected_checksum" ]]; then
    echo "checksum mismatch for $archive_name" >&2
    exit 1
  fi
  if ! unzip -Z1 "$archive_path" | grep -Eq "(^|/)$binary_name$"; then
    echo "$archive_name does not contain $binary_name" >&2
    exit 1
  fi

  manifest_entries+=("$destination|$archive_name|$actual_checksum")
done

if [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]]; then
  unzip -q "$temporary_root/nuclei_${version}_linux_amd64.zip" nuclei -d "$temporary_root/smoke"
  chmod +x "$temporary_root/smoke/nuclei"
  if ! "$temporary_root/smoke/nuclei" -version 2>&1 | grep -q "v$version"; then
    echo "downloaded Linux binary did not report v$version" >&2
    exit 1
  fi
fi

# Promote only after every platform archive and the Linux smoke test pass, so
# an incomplete or tampered release cannot partially replace the pinned set.
for manifest_entry in "${manifest_entries[@]}"; do
  IFS='|' read -r destination archive_name _ <<< "$manifest_entry"
  destination_root="$archive_root/$destination"
  mkdir -p "$destination_root"
  cp "$temporary_root/$archive_name" "$destination_root/$archive_name"
done

for manifest_entry in "${manifest_entries[@]}"; do
  IFS='|' read -r destination archive_name _ <<< "$manifest_entry"
  destination_root="$archive_root/$destination"
  for existing_archive in "$destination_root"/nuclei_*.zip; do
    if [[ -f "$existing_archive" && "$(basename "$existing_archive")" != "$archive_name" ]]; then
      rm "$existing_archive"
    fi
  done
done

manifest_path="$archive_root/nuclei-manifest.json"
manifest_temporary="$(mktemp "$archive_root/.nuclei-manifest.XXXXXX")"
{
  printf '{\n'
  printf '  "version": "%s",\n' "$version"
  printf '  "source": "projectdiscovery/nuclei",\n'
  printf '  "releaseUrl": "https://github.com/projectdiscovery/nuclei/releases/tag/v%s",\n' "$version"
  printf '  "artifacts": {\n'
  for index in "${!manifest_entries[@]}"; do
    IFS='|' read -r destination archive_name checksum <<< "${manifest_entries[$index]}"
    separator=','
    if [[ "$index" -eq $((${#manifest_entries[@]} - 1)) ]]; then
      separator=''
    fi
    printf '    "%s": { "file": "%s", "sha256": "%s" }%s\n' \
      "$destination" "$archive_name" "$checksum" "$separator"
  done
  printf '  }\n'
  printf '}\n'
} > "$manifest_temporary"
mv "$manifest_temporary" "$manifest_path"

echo "Updated pinned Nuclei artifacts to v$version"
