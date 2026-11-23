#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
if [[ $# -ne 2 ]]; then
  echo "Usage: $0 INPUT.AppImage OUTPUT.AppImage" >&2
  exit 2
fi
input=$(realpath "$1")
output=$(realpath -m "$2")
[[ "$input" != "$output" && ! -e "$output" && ! -e "$output.zsync" ]]
metadata=com.kevinobytes.remoteku.metainfo.xml
feed='gh-releases-zsync|KevinOBytes|remoteku|latest|RemoteKu-*.AppImage.zsync'
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
appstreamcli validate --no-net "$repo_dir/build/$metadata"
(cd "$work" && "$input" --appimage-extract >/dev/null)
appdir="$work/squashfs-root"
desktop="$appdir/remoteku.desktop"
[[ -f "$desktop" ]]
install -Dm644 "$repo_dir/build/$metadata" "$appdir/usr/share/metainfo/$metadata"
install -Dm644 "$desktop" "$appdir/usr/share/applications/remoteku.desktop"
(cd "$(dirname "$output")" && ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 appimagetool --updateinformation "$feed" "$appdir" "$(basename "$output")")
(cd "$(dirname "$output")" && zsyncmake -u "$(basename "$output")" -o "$(basename "$output").zsync" "$(basename "$output")")
[[ -s "$output.zsync" ]]
[[ "$("$output" --appimage-updateinformation)" == "$feed" ]]
grep -aqFx "Filename: $(basename "$output")" "$output.zsync"
grep -aqFx "Length: $(stat -c %s "$output")" "$output.zsync"
grep -aqFx "SHA-1: $(sha1sum "$output" | cut -d " " -f 1)" "$output.zsync"
mkdir "$work/final"
(cd "$work/final" && "$output" --appimage-extract "usr/share/metainfo/$metadata" >/dev/null)
cmp "$repo_dir/build/$metadata" "$work/final/squashfs-root/usr/share/metainfo/$metadata"
