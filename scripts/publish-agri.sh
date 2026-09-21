#!/usr/bin/env bash
# Publish Agro_widgetV6 (built) to abdullajonov1/agri GitHub Pages.
# Portal URL (stable — same after every publish):
#   https://abdullajonov1.github.io/agri/widgets/Agro_widgetV6/manifest.json
#
# EXB portal needs BOTH:
#   widgets/Agro_widgetV6/...
#   widgets/chunks/...
#
# After code changes:
#   1) npm start / build so client/dist/... is fresh
#   2) bash scripts/publish-agri.sh
#   3) Portal → Custom widgets → Agro_widgetV6 → Update
#      (Pages updates immediately; Portal caches until Update)
#
# Usage:
#   bash scripts/publish-agri.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXB_CLIENT="$(cd "$ROOT/../../../.." && pwd)"
DIST_SRC="$EXB_CLIENT/dist/widgets/Agri3/Agro_widgetV5"
PROD_SRC="$EXB_CLIENT/dist-prod/widgets/Agri3/Agro_widgetV5"
CHUNKS_SRC="$EXB_CLIENT/dist/widgets/chunks"
PROD_CHUNKS="$EXB_CLIENT/dist-prod/widgets/chunks"
WORK="${TMPDIR:-/tmp}/agri-publish-$$"
REPO="abdullajonov1/agri"
PAGES_URL="https://abdullajonov1.github.io/agri/widgets/Agro_widgetV6/manifest.json"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('$ROOT/manifest.json','utf8')).version" 2>/dev/null || echo "6.1.1")"

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
  echo "No widgets/chunks folder found — portal will fail import()."
  exit 1
fi

echo "Using build:   $SRC"
echo "Using chunks:  $CHUNKS"
echo "Version:       $VERSION"

rm -rf "$WORK"
gh repo clone "$REPO" "$WORK" -- --depth 1

# Keep source on main for clone/dev; refresh portal package + source tree.
rm -rf "$WORK/widgets" "$WORK/src" "$WORK/scripts"
mkdir -p "$WORK/widgets/Agro_widgetV6" "$WORK/widgets/chunks"
cp -r "$SRC/dist" "$WORK/widgets/Agro_widgetV6/"
cp "$ROOT/config.json" "$WORK/widgets/Agro_widgetV6/config.json"
cp "$ROOT/icon.svg" "$WORK/widgets/Agro_widgetV6/icon.svg"
cp -r "$CHUNKS/." "$WORK/widgets/chunks/"

# Mirror ExB widget source so the agri repo stays a usable clone target.
cp -r "$ROOT/src" "$WORK/src"
cp -r "$ROOT/scripts" "$WORK/scripts"
cp "$ROOT/manifest.json" "$WORK/manifest.json"
cp "$ROOT/config.json" "$WORK/config.json"
cp "$ROOT/icon.svg" "$WORK/icon.svg"
if [ -f "$ROOT/setting.tsx" ]; then cp "$ROOT/setting.tsx" "$WORK/setting.tsx"; fi
if [ -f "$ROOT/runtime/widget.tsx" ]; then
  mkdir -p "$WORK/runtime"
  # Prefer full runtime/ if present in widget root layout.
  :
fi
# Copy common root widget entry files when present.
for f in setting.tsx setting.tsx.bak code.ts; do
  [ -f "$ROOT/$f" ] && cp "$ROOT/$f" "$WORK/$f" || true
done
if [ -d "$ROOT/runtime" ]; then cp -r "$ROOT/runtime" "$WORK/runtime"; fi
if [ -d "$ROOT/setting" ]; then cp -r "$ROOT/setting" "$WORK/setting"; fi
if [ -d "$ROOT/dist" ]; then cp -r "$ROOT/dist" "$WORK/dist"; fi
if [ -f "$ROOT/package.json" ]; then cp "$ROOT/package.json" "$WORK/package.json"; fi
if [ -f "$ROOT/tsconfig.json" ]; then cp "$ROOT/tsconfig.json" "$WORK/tsconfig.json"; fi
if [ -f "$ROOT/.gitignore" ]; then cp "$ROOT/.gitignore" "$WORK/.gitignore"; fi

cat > "$WORK/widgets/Agro_widgetV6/manifest.json" <<EOF
{
  "name": "Agro_widgetV6",
  "label": "Space Agro Monitoring V6",
  "type": "widget",
  "version": "$VERSION",
  "exbVersion": "1.16.0",
  "author": "abdullajonov1",
  "description": "Agri portal package (single-date export-image, eager Graff+Popup). Source: https://github.com/abdullajonov1/agri",
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

# Pages from repo root
touch "$WORK/.nojekyll"

# README for portal users
cat > "$WORK/README.md" <<'EOF'
# agri — Space Agro Monitoring (Agro_widgetV5 / V6)

## Portal (Experience Builder)

Stable manifest URL (use this in Portal custom widgets):

https://abdullajonov1.github.io/agri/widgets/Agro_widgetV6/manifest.json

After each code change, republish the built package (`bash scripts/publish-agri.sh` from the ExB widget folder). Then in Portal: **Custom widgets → Agro_widgetV6 → Update**.

GitHub Pages updates automatically on push; Portal caches the old build until you click **Update**.

## Local development

Clone this repo into ExB:

`client/your-extensions/widgets/Agro_widgetV5/`

Then `npm start` in the ExB client.

Do **not** register the raw GitHub source URL as a custom widget — Portal needs `widgets/Agro_widgetV6` + `widgets/chunks`.
EOF

cd "$WORK"
# Source .gitignore ignores "dist/" — force-add the portal package tree.
git add -A
git add -f widgets/
if git diff --cached --quiet; then
  echo "No changes to publish."
  exit 0
fi
MSG="Publish Agro_widgetV6 $VERSION ($(date -u +%Y-%m-%dT%H:%MZ))"
git -c user.email="abdullajonov1@users.noreply.github.com" -c user.name="abdullajonov1" commit -m "$MSG"
git push origin HEAD

# Ensure GitHub Pages is on (main / root)
gh api -X POST "repos/$REPO/pages" -f build_type=legacy -f source[branch]=main -f source[path]=/ 2>/dev/null \
  || gh api -X PUT "repos/$REPO/pages" -f build_type=legacy -f source[branch]=main -f source[path]=/ 2>/dev/null \
  || true

echo ""
echo "Published. Portal manifest URL:"
echo "  $PAGES_URL"
echo "GitHub Pages may take 1–2 minutes. Then Update Agro_widgetV6 in Portal."
