#!/usr/bin/env bash
set -euo pipefail

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

repository_root="$test_root/repository"
release_root="$test_root/release"
mkdir -p "$repository_root/core-api/public/archived" "$release_root"

platforms=(linux_amd64 linux_arm64 macOS_amd64 windows_amd64)
for platform in "${platforms[@]}"; do
  package_root="$test_root/package-$platform"
  mkdir -p "$package_root"
  binary_name="nuclei"
  if [[ "$platform" == windows_amd64 ]]; then
    binary_name="nuclei.exe"
  fi
  printf '#!/usr/bin/env sh\nprintf "Nuclei Engine Version: v9.9.9\\n"\n' > "$package_root/$binary_name"
  chmod +x "$package_root/$binary_name"
  (
    cd "$package_root"
    zip -q "$release_root/nuclei_9.9.9_${platform}.zip" "$binary_name"
  )
done

(
  cd "$release_root"
  shasum -a 256 nuclei_9.9.9_*.zip > nuclei_9.9.9_checksums.txt
)

for destination in linux_amd64 linux_arm64 macos_amd64 windows_amd64; do
  mkdir -p "$repository_root/core-api/public/archived/$destination"
  touch "$repository_root/core-api/public/archived/$destination/nuclei_1.0.0_old.zip"
done

OASM_REPOSITORY_ROOT="$repository_root" \
OASM_NUCLEI_RELEASE_BASE_URL="file://$release_root" \
  "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/update-nuclei-artifacts.sh" 9.9.9

test -f "$repository_root/core-api/public/archived/linux_amd64/nuclei_9.9.9_linux_amd64.zip"
test -f "$repository_root/core-api/public/archived/linux_arm64/nuclei_9.9.9_linux_arm64.zip"
test -f "$repository_root/core-api/public/archived/macos_amd64/nuclei_9.9.9_macOS_amd64.zip"
test -f "$repository_root/core-api/public/archived/windows_amd64/nuclei_9.9.9_windows_amd64.zip"

if find "$repository_root/core-api/public/archived" -name 'nuclei_1.0.0_old.zip' -print -quit | grep -q .; then
  echo "old Nuclei archives were not removed" >&2
  exit 1
fi

manifest="$repository_root/core-api/public/archived/nuclei-manifest.json"
grep -q '"version": "9.9.9"' "$manifest"
grep -q '"source": "projectdiscovery/nuclei"' "$manifest"
grep -q '"linux_amd64"' "$manifest"

rollback_repository="$test_root/rollback-repository"
rollback_release="$test_root/rollback-release"
cp -R "$release_root" "$rollback_release"
printf 'tampered' >> "$rollback_release/nuclei_9.9.9_windows_amd64.zip"

for destination in linux_amd64 linux_arm64 macos_amd64 windows_amd64; do
  mkdir -p "$rollback_repository/core-api/public/archived/$destination"
  touch "$rollback_repository/core-api/public/archived/$destination/nuclei_1.0.0_old.zip"
done

if OASM_REPOSITORY_ROOT="$rollback_repository" \
  OASM_NUCLEI_RELEASE_BASE_URL="file://$rollback_release" \
  "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/update-nuclei-artifacts.sh" 9.9.9; then
  echo "tampered release was accepted" >&2
  exit 1
fi

for destination in linux_amd64 linux_arm64 macos_amd64 windows_amd64; do
  test -f "$rollback_repository/core-api/public/archived/$destination/nuclei_1.0.0_old.zip"
done
test ! -f "$rollback_repository/core-api/public/archived/nuclei-manifest.json"
