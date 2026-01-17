#!/bin/bash
# FastWrite Release Build Script
# Builds a single binary with embedded web frontend

set -e

echo "🚀 Building FastWrite Release..."

# Step 1: Build the web frontend
echo "📦 Building web frontend..."
cd web
bun run build
cd ..

# Step 2: Compile Bun executable with embedded static files
echo "🔧 Compiling Bun executable..."

# Create a build entry that embeds the static files
bun build --compile --target=bun --outfile=fastwrite ./src/server.ts

# Check if build succeeded
if [ -f "./fastwrite" ]; then
    echo "✅ Build complete!"
    echo ""
    echo "📁 Output: ./fastwrite"
    echo "📏 Size: $(du -h ./fastwrite | cut -f1)"
    echo ""
    echo "To run: ./fastwrite"
    echo "The server will start at http://localhost:3002"
else
    echo "❌ Build failed!"
    exit 1
fi
