#!/bin/bash
# render-outfits.sh — compile and run the Kito outfit planche renderer
# NOT in CI. Run manually: bash scripts/render-outfits.sh
# Output: /tmp/jichobot-outfits.png

set -e
cd "$(dirname "$0")/.."

SDK=$(xcrun --sdk macosx --show-sdk-path)

echo "Compiling renderer..."
swiftc \
  -parse-as-library \
  -sdk "$SDK" \
  -target arm64-apple-macosx15.0 \
  JichoBot/Sources/JichoBotKit/IslandScreenGeometry.swift \
  JichoBot/Sources/JichoBotKit/IslandTypes.swift \
  JichoBot/Sources/JichoBotKit/KitoWardrobe.swift \
  JichoBot/Sources/JichoBotKit/BotEngine.swift \
  JichoBot/Sources/JichoBotKit/KitoOutfitDrawing.swift \
  scripts/RenderOutfits.swift \
  -framework AppKit \
  -framework SwiftUI \
  -o /tmp/jichobot-render-outfits \
  2>&1

echo "Running renderer..."
/tmp/jichobot-render-outfits
echo "Opening..."
open /tmp/jichobot-outfits.png
