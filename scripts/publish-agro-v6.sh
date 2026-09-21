#!/usr/bin/env bash
# Publish Agro_widgetV6 to GitHub Pages (separate agro-monitoring repo).
# EXB portal requires:
#   widgets/Agro_widgetV6/...
#   widgets/chunks/...   (sibling — needed for import())
#
# Portal URL:
#   https://abdullajonov1.github.io/agro-monitoring/widgets/Agro_widgetV6/manifest.json
#
# Usage:
#   bash scripts/publish-agro-v6.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXB_CLIENT="$(cd "$ROOT/../../../.." && pwd)"
DIST_SRC="$EXB_CLIENT/dist/widgets/Agri3/Agro_widgetV5"
PROD_SRC="$EXB_CLIENT/dist-prod/widgets/Agri3/Agro_widgetV5"
CHUNKS_SRC="$EXB_CLIENT/dist/widgets/chunks"
PROD_CHUNKS="$EXB_CLIENT/dist-prod/widgets/chunks"
WORK="${TMPDIR:-/tmp}/agro-v6-publish-$$"
REPO="abdullajonov1/agro-monitoring"
PAGES_URL="https://abdullajonov1.github.io/agro-monitoring/widgets/Agro_widgetV6/manifest.json"

SRC=""
CHUNKS=""
if [ -d "$PROD_SRC/dist" ]; then
  SRC="$PROD_SRC"
elif [ -d "$DIST_SRC/dist" ]; then
  SRC="$DIST_SRC"
else
  echo "No built widget found. Run EXB client (npm start) or build:prod first."
  exit 1
fi
if [ -d "$PROD_CHUNKS" ]; then
  CHUNKS="$PROD_CHUNKS"
elif [ -d "$CHUNKS_SRC" ]; then
  CHUNKS="$CHUNKS_SRC"
else
  echo "No widgets/chunks folder found next to the EXB build — portal will fail import()."
  exit 1
fi

echo "Using build:   $SRC"
echo "Using chunks:  $CHUNKS"
rm -rf "$WORK"
gh repo clone "$REPO" "$WORK" -- --depth 1
rm -rf "$WORK/Agro_widgetV6" "$WORK/widgets"
mkdir -p "$WORK/widgets/Agro_widgetV6" "$WORK/widgets/chunks"
cp -r "$SRC/dist" "$WORK/widgets/Agro_widgetV6/"
cp "$ROOT/config.json" "$WORK/widgets/Agro_widgetV6/config.json"
cp "$ROOT/icon.svg" "$WORK/widgets/Agro_widgetV6/icon.svg"
cp -r "$CHUNKS/." "$WORK/widgets/chunks/"

cat > "$WORK/widgets/Agro_widgetV6/manifest.json" <<'EOF'
{
  "name": "Agro_widgetV6",
  "label": "Space Agro Monitoring V6",
  "type": "widget",
  "version": "6.1.0",
  "exbVersion": "1.16.0",
  "author": "abdullajonov1",
  "description": "Portal build 6.1.0: single-date export-image, eager Graff+Popup. Update Agro_widgetV6 in Portal (not Agro-main-widget).",
  "copyright": "",
  "license": "",
  "properties": {
    "supportAutoSize": false
  },
  "translatedLocales": [
    "en",
    "uz",
    "ru"
  ],
  "defaultSize": {
    "width": 1920,
    "height": 920
  },
  "supports": {
    "map": true
  },
  "dependency": [
    "jimu-arcgis"
  ],
  "supportInlineEditing": true,
  "hasSettingPage": true,
  "useDataSources": true
}
EOF

touch "$WORK/.nojekyll"
cd "$WORK"
git add -A
if git diff --cached --quiet; then
  echo "No changes to publish."
  exit 0
fi
MSG="Update Agro_widgetV6 ($(date -u +%Y-%m-%dT%H:%MZ))"
git -c user.email="abdullajonov1@users.noreply.github.com" -c user.name="abdullajonov1" commit -m "$MSG"
git push origin HEAD
echo ""
echo "Published. Register / re-check this URL in Portal:"
echo "  $PAGES_URL"
echo "GitHub Pages may take 1–2 minutes."
