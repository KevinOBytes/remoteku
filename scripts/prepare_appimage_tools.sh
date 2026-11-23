#!/usr/bin/env bash
set -euo pipefail
destination=${1:?tool directory required}
mkdir -p "$destination"
curl --fail --show-error --silent --location --retry 3 \
  https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage \
  --output "$destination/appimagetool"
printf '%s  %s\n' ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0 "$destination/appimagetool" | sha256sum --check --status
chmod +x "$destination/appimagetool"
