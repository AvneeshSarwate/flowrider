#!/bin/bash
set -e

echo "Installing dependencies..."
npm install
cd webview-ui && npm install && cd ..

echo "Building extension..."
npm run build

echo "Packaging extension..."
npx vsce package

VSIX_FILE=$(ls -t *.vsix | head -1)
echo "Installing $VSIX_FILE..."
code --install-extension "$VSIX_FILE"

echo "Done! Reload VS Code to use the extension."
