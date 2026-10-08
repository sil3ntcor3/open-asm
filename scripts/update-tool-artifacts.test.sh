#!/usr/bin/env bash
#
# Offline test for scripts/update-tool-artifacts.sh. Builds a fake release
# directory, serves it over file://, and asserts that verified releases are
# promoted, superseded archives are pruned, the manifest describes every
# pinned tool, and a tampered archive leaves the repository untouched.
set -euo pipefail

script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
updater="$script_root/update-tool-artifacts.sh"

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

platforms=(linux_amd64 linux_arm64 macOS_amd64 windows_amd64)
destinations=(linux_amd64 linux_arm64 macos_amd64 windows_amd64)

# A pin file holding two tools proves the manifest covers the whole pinned set
# even when only one tool is refreshed.
pin_file="$test_root/tool-versions.json"
cat > "$pin_file" <<'JSON'
{
  "tools": { "httpx": "9.9.9", "nuclei": "9.9.9" },
  "nucleiTemplates": { "version": "1.2.3", "sha256": "0000" }
}
JSON

build_release() {
  local release_root="$1"
  mkdir -p "$release_root"
  local tool platform binary_name package_root
  for tool in httpx nuclei; do
    for platform in "${platforms[@]}"; do
      binary_name="$tool"
      if [[ "$platform" == windows_* ]]; then
        binary_name="$tool.exe"
      fi
      package_root="$test_root/package-$tool-$platform"
      rm -rf "$package_root"
      mkdir -p "$package_root"
      printf '#!/usr/bin/env sh\nprintf "Current Version: v9.9.9\\n"\n' > "$package_root/$binary_name"
      chmod +x "$package_root/$binary_name"
      ( cd "$package_root" && zip -q "$release_root/${tool}_9.9.9_${platform}.zip" "$binary_name" )
    done
    ( cd "$release_root" && shasum -a 256 "${tool}"_9.9.9_*.zip > "${tool}_9.9.9_checksums.txt" )
  done
}

seed_repository() {
  local repository_root="$1" destination
  for destination in "${destinations[@]}"; do
    mkdir -p "$repository_root/core-api/public/archived/$destination"
    touch "$repository_root/core-api/public/archived/$destination/nuclei_1.0.0_old.zip"
    touch "$repository_root/core-api/public/archived/$destination/httpx_1.0.0_old.zip"
  done
}

release_root="$test_root/release"
repository_root="$test_root/repository"
build_release "$release_root"
seed_repository "$repository_root"

OASM_REPOSITORY_ROOT="$repository_root" \
OASM_TOOL_VERSIONS_FILE="$pin_file" \
OASM_TOOL_RELEASE_BASE="file://$release_root" \
  "$updater" >/dev/null

archived="$repository_root/core-api/public/archived"
for index in "${!platforms[@]}"; do
  test -f "$archived/${destinations[$index]}/nuclei_9.9.9_${platforms[$index]}.zip"
  test -f "$archived/${destinations[$index]}/httpx_9.9.9_${platforms[$index]}.zip"
done

if find "$archived" -name '*_1.0.0_old.zip' -print -quit | grep -q .; then
  echo "superseded archives were not removed" >&2
  exit 1
fi

manifest="$archived/tool-manifest.json"
python3 - "$manifest" "$archived" <<'PY'
import hashlib, json, os, sys

manifest_path, archive_root = sys.argv[1], sys.argv[2]
manifest = json.load(open(manifest_path))
assert manifest["schemaVersion"] == 1, manifest
assert sorted(manifest["tools"]) == ["httpx", "nuclei"], sorted(manifest["tools"])
for tool, entry in manifest["tools"].items():
    assert entry["version"] == "9.9.9", entry
    assert entry["source"] == f"projectdiscovery/{tool}", entry
    assert sorted(entry["artifacts"]) == [
        "linux_amd64",
        "linux_arm64",
        "macos_amd64",
        "windows_amd64",
    ], entry
    for platform, declaration in entry["artifacts"].items():
        path = os.path.join(archive_root, platform, declaration["file"])
        digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
        assert digest == declaration["sha256"], (path, digest, declaration)
print("manifest OK")
PY

# Re-running must be a no-op: already-pinned archives verify by digest instead
# of being downloaded again.
before="$(shasum -a 256 "$archived/linux_amd64/nuclei_9.9.9_linux_amd64.zip")"
OASM_REPOSITORY_ROOT="$repository_root" \
OASM_TOOL_VERSIONS_FILE="$pin_file" \
OASM_TOOL_RELEASE_BASE="file://$release_root" \
  "$updater" nuclei >/dev/null
test "$before" = "$(shasum -a 256 "$archived/linux_amd64/nuclei_9.9.9_linux_amd64.zip")"

# A tampered release must leave the repository exactly as it was.
rollback_repository="$test_root/rollback-repository"
rollback_release="$test_root/rollback-release"
build_release "$rollback_release"
seed_repository "$rollback_repository"
printf 'tampered' >> "$rollback_release/nuclei_9.9.9_windows_amd64.zip"

if OASM_REPOSITORY_ROOT="$rollback_repository" \
  OASM_TOOL_VERSIONS_FILE="$pin_file" \
  OASM_TOOL_RELEASE_BASE="file://$rollback_release" \
  "$updater" >/dev/null 2>&1; then
  echo "tampered release was accepted" >&2
  exit 1
fi

for destination in "${destinations[@]}"; do
  test -f "$rollback_repository/core-api/public/archived/$destination/nuclei_1.0.0_old.zip"
done
test ! -f "$rollback_repository/core-api/public/archived/tool-manifest.json"

# The worker image seed must stay in lockstep with the pin file, otherwise a
# rebuilt worker bakes a different template set than the one recorded here.
repository_pin="$script_root/tool-versions.json"
if [[ -f "$repository_pin" ]]; then
  python3 - "$repository_pin" "$script_root/../worker/Dockerfile" <<'PY'
import json, re, sys

pin = json.load(open(sys.argv[1]))["nucleiTemplates"]
dockerfile = open(sys.argv[2]).read()
for argument, expected in (
    ("NUCLEI_TEMPLATES_VERSION", pin["version"]),
    ("NUCLEI_TEMPLATES_SHA256", pin["sha256"]),
):
    match = re.search(rf"^ARG {argument}=(\S+)$", dockerfile, re.MULTILINE)
    assert match, f"worker/Dockerfile is missing ARG {argument}"
    assert match.group(1) == expected, (
        f"worker/Dockerfile {argument}={match.group(1)} but scripts/tool-versions.json pins {expected}"
    )
print("worker template seed pin OK")
PY
fi

echo "update-tool-artifacts.sh tests passed"
