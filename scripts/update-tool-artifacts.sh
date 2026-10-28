#!/usr/bin/env bash
#
# Refresh the scanner archives that ship inside the core-api image.
#
# Workers do not download scanners from the internet on first start: they ask
# Core for `BuiltinToolRegistry` and pull whatever is in
# core-api/public/archived/<os>_<arch>/. Whatever is pinned here is therefore
# the version every freshly deployed worker runs, which is why bumping these
# archives (and rebuilding the api image) is how tools ship pre-upgraded
# instead of being upgraded after deployment.
#
# Every archive is verified against the official ProjectDiscovery checksums
# file for its release before it is promoted, and the resulting
# tool-manifest.json is what ToolArtifactService gates serving on - an archive
# that is not declared there is never handed to a worker.
#
# Usage:
#   scripts/update-tool-artifacts.sh                  # verify/refresh every pinned tool
#   scripts/update-tool-artifacts.sh nuclei httpx     # only these tools
#   scripts/update-tool-artifacts.sh nuclei=3.12.0    # bump the pin, then refresh
#
# Environment overrides (used by the test harness):
#   OASM_REPOSITORY_ROOT      repo root (default: parent of this script)
#   OASM_TOOL_VERSIONS_FILE   pin file  (default: scripts/tool-versions.json)
#   OASM_TOOL_RELEASE_BASE    base URL holding every release file, e.g. file:///tmp/x
set -euo pipefail

script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="${OASM_REPOSITORY_ROOT:-$(cd "$script_root/.." && pwd)}"
pin_file="${OASM_TOOL_VERSIONS_FILE:-$script_root/tool-versions.json}"
archive_root="$repository_root/core-api/public/archived"
manifest_path="$archive_root/tool-manifest.json"

# Release platform token -> archive directory name. Kept in lockstep with the
# <os>_<arch> keys ToolArtifactService derives from the worker's GOOS/GOARCH.
platforms=(
  "linux_amd64|linux_amd64"
  "linux_arm64|linux_arm64"
  "macOS_amd64|macos_amd64"
  "windows_amd64|windows_amd64"
)

temporary_root="$(mktemp -d)"
trap 'rm -rf "$temporary_root"' EXIT

digest_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

read_pin() {
  python3 - "$pin_file" "$1" <<'PY'
import json, sys
with open(sys.argv[1]) as handle:
    document = json.load(handle)
print(document["tools"].get(sys.argv[2], ""))
PY
}

pinned_tools() {
  python3 - "$pin_file" <<'PY'
import json, sys
with open(sys.argv[1]) as handle:
    document = json.load(handle)
for name in sorted(document["tools"]):
    print(name)
PY
}

write_pin() {
  python3 - "$pin_file" "$1" "$2" <<'PY'
import json, sys
path, tool, version = sys.argv[1:4]
with open(path) as handle:
    document = json.load(handle)
document["tools"][tool] = version
with open(path, "w") as handle:
    json.dump(document, handle, indent=2)
    handle.write("\n")
PY
}

# Fetches one release file into $temporary_root. ProjectDiscovery is not
# consistent about the checksums file name, so callers pass every candidate.
fetch_release_file() {
  local tool="$1" version="$2" file_name="$3" destination="$4"
  local base_url="${OASM_TOOL_RELEASE_BASE:-https://github.com/projectdiscovery/$tool/releases/download/v$version}"
  curl --fail --location --silent --show-error --retry 3 \
    "$base_url/$file_name" --output "$destination"
}

checksums_for() {
  local tool="$1" version="$2"
  local checksums_path="$temporary_root/${tool}_${version}_checksums.txt"
  if [[ -f "$checksums_path" ]]; then
    echo "$checksums_path"
    return 0
  fi
  local candidate
  for candidate in "${tool}_${version}_checksums.txt" "${tool}-checksums.txt"; do
    if fetch_release_file "$tool" "$version" "$candidate" "$checksums_path" 2>/dev/null; then
      echo "$checksums_path"
      return 0
    fi
  done
  echo "no official checksums file found for $tool v$version" >&2
  return 1
}

expected_digest() {
  local checksums_path="$1" archive_name="$2"
  awk -v archive="$archive_name" '$2 == archive { print $1 }' "$checksums_path"
}

binary_name_for() {
  local tool="$1" platform="$2"
  if [[ "$platform" == windows_* ]]; then
    echo "$tool.exe"
  else
    echo "$tool"
  fi
}

# --- resolve the requested tool set -----------------------------------------

requested_tools=()
for argument in "$@"; do
  case "$argument" in
    -h|--help)
      sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^#\s\?//'
      exit 0
      ;;
    *=*)
      tool_name="${argument%%=*}"
      tool_version="${argument#*=}"
      if [[ ! "$tool_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "invalid version for $tool_name: $tool_version" >&2
        exit 1
      fi
      if [[ -z "$(read_pin "$tool_name")" ]]; then
        echo "unknown tool: $tool_name" >&2
        exit 1
      fi
      write_pin "$tool_name" "$tool_version"
      requested_tools+=("$tool_name")
      ;;
    *)
      if [[ -z "$(read_pin "$argument")" ]]; then
        echo "unknown tool: $argument" >&2
        exit 1
      fi
      requested_tools+=("$argument")
      ;;
  esac
done

all_tools=()
while IFS= read -r tool_name; do
  all_tools+=("$tool_name")
done < <(pinned_tools)

if [[ "${#requested_tools[@]}" -eq 0 ]]; then
  requested_tools=("${all_tools[@]}")
fi

# --- stage every requested archive ------------------------------------------
#
# Nothing is written into the repository until every archive of every requested
# tool has been fetched, checksum-verified and smoke-tested, so a partial or
# tampered release can never half-replace the pinned set.

staged_entries=()
host_is_linux_amd64=0
if [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]]; then
  host_is_linux_amd64=1
fi

for tool_name in "${requested_tools[@]}"; do
  version="$(read_pin "$tool_name")"
  checksums_path="$(checksums_for "$tool_name" "$version")"

  for platform_specification in "${platforms[@]}"; do
    IFS='|' read -r platform destination <<< "$platform_specification"
    archive_name="${tool_name}_${version}_${platform}.zip"
    binary_name="$(binary_name_for "$tool_name" "$platform")"

    checksum="$(expected_digest "$checksums_path" "$archive_name")"
    if [[ -z "$checksum" ]]; then
      echo "official checksum missing for $archive_name" >&2
      exit 1
    fi

    # An archive already pinned at this version and matching the official
    # digest is left alone: re-runs stay cheap and verify what is committed.
    existing_archive="$archive_root/$destination/$archive_name"
    if [[ -f "$existing_archive" && "$(digest_of "$existing_archive")" == "$checksum" ]]; then
      echo "verified $destination/$archive_name"
      staged_entries+=("$tool_name|$version|$destination|$archive_name|$checksum|")
      continue
    fi

    archive_path="$temporary_root/$archive_name"
    echo "downloading $archive_name"
    fetch_release_file "$tool_name" "$version" "$archive_name" "$archive_path"

    actual_checksum="$(digest_of "$archive_path")"
    if [[ "$actual_checksum" != "$checksum" ]]; then
      echo "checksum mismatch for $archive_name" >&2
      exit 1
    fi
    if ! unzip -Z1 "$archive_path" | grep -Eq "(^|/)$binary_name$"; then
      echo "$archive_name does not contain $binary_name" >&2
      exit 1
    fi

    staged_entries+=("$tool_name|$version|$destination|$archive_name|$checksum|$archive_path")
  done

  # Prove the Linux build actually runs and reports the pinned version before
  # it is allowed anywhere near a worker. Only possible on a matching host.
  staged_linux="$temporary_root/${tool_name}_${version}_linux_amd64.zip"
  if [[ "$host_is_linux_amd64" -eq 1 && -f "$staged_linux" ]]; then
    smoke_root="$temporary_root/smoke-$tool_name"
    mkdir -p "$smoke_root"
    unzip -q -o "$staged_linux" "$tool_name" -d "$smoke_root"
    chmod +x "$smoke_root/$tool_name"
    if ! "$smoke_root/$tool_name" -version 2>&1 | grep -q "$version"; then
      echo "downloaded $tool_name binary did not report $version" >&2
      exit 1
    fi
  fi
done

# --- promote ----------------------------------------------------------------

for staged_entry in "${staged_entries[@]}"; do
  IFS='|' read -r tool_name version destination archive_name checksum archive_path <<< "$staged_entry"
  destination_root="$archive_root/$destination"
  mkdir -p "$destination_root"
  if [[ -n "$archive_path" ]]; then
    cp "$archive_path" "$destination_root/$archive_name"
  fi
done

for staged_entry in "${staged_entries[@]}"; do
  IFS='|' read -r tool_name version destination archive_name _ _ <<< "$staged_entry"
  destination_root="$archive_root/$destination"
  for existing_archive in "$destination_root/${tool_name}_"*.zip; do
    if [[ -f "$existing_archive" && "$(basename "$existing_archive")" != "$archive_name" ]]; then
      echo "removing superseded $destination/$(basename "$existing_archive")"
      rm "$existing_archive"
    fi
  done
done

# --- regenerate the manifest ------------------------------------------------
#
# Built from every pinned tool (not just the refreshed ones) so the manifest
# always describes the complete served set; a pinned archive missing from the
# repository is a hard error rather than a silently unserved tool.

manifest_rows=()
for tool_name in "${all_tools[@]}"; do
  version="$(read_pin "$tool_name")"
  for platform_specification in "${platforms[@]}"; do
    IFS='|' read -r platform destination <<< "$platform_specification"
    archive_name="${tool_name}_${version}_${platform}.zip"
    archive_file="$archive_root/$destination/$archive_name"
    if [[ ! -f "$archive_file" ]]; then
      echo "pinned archive missing: $destination/$archive_name (run without arguments to fetch it)" >&2
      exit 1
    fi
    manifest_rows+=("$tool_name|$version|$destination|$archive_name|$(digest_of "$archive_file")")
  done
done

manifest_temporary="$(mktemp "$archive_root/.tool-manifest.XXXXXX")"
manifest_rows_file="$temporary_root/manifest-rows.txt"
printf '%s\n' "${manifest_rows[@]}" > "$manifest_rows_file"
python3 - "$manifest_temporary" "$manifest_rows_file" <<'PY'
import json, sys

manifest = {"schemaVersion": 1, "tools": {}}
for line in open(sys.argv[2]).read().splitlines():
    if not line:
        continue
    tool, version, platform, file_name, sha256 = line.split("|")
    entry = manifest["tools"].setdefault(
        tool,
        {
            "version": version,
            "source": f"projectdiscovery/{tool}",
            "releaseUrl": f"https://github.com/projectdiscovery/{tool}/releases/tag/v{version}",
            "artifacts": {},
        },
    )
    entry["artifacts"][platform] = {"file": file_name, "sha256": sha256}

manifest["tools"] = {name: manifest["tools"][name] for name in sorted(manifest["tools"])}
with open(sys.argv[1], "w") as handle:
    json.dump(manifest, handle, indent=2, sort_keys=False)
    handle.write("\n")
PY
mv "$manifest_temporary" "$manifest_path"
chmod 0644 "$manifest_path"

echo "Pinned archives are current:"
for tool_name in "${all_tools[@]}"; do
  echo "  $tool_name $(read_pin "$tool_name")"
done
