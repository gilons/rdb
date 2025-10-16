#!/bin/bash
set -e

echo "🧹 Cleaning previous builds..."
rm -rf dist dist-esm

echo "📦 Building CommonJS..."
npx tsc --project tsconfig.cjs.json

echo "📦 Building ESM..."
npx tsc --project tsconfig.esm.json

echo "📝 Building TypeScript declarations..."
npx tsc --project tsconfig.types.json

echo "🔧 Processing ESM build..."
# Rename JS files in dist-esm to .mjs and copy to dist
if [ -d "dist-esm" ]; then
  find dist-esm -name "*.js" -type f | while read file; do
    # Get the relative path from dist-esm
    relative_path="${file#dist-esm/}"
    # Create the target path in dist with .mjs extension
    target_path="dist/${relative_path%.js}.mjs"
    # Create directory if it doesn't exist
    mkdir -p "$(dirname "$target_path")"
    # Copy and rename
    cp "$file" "$target_path"
  done
fi

echo "📋 Adding package.json marker for ESM support..."
echo '{"type": "module"}' > dist/package.esm.json

echo "✨ Build complete!"
echo "📊 Build summary:"
if [ -d "dist" ]; then
  echo "  - CommonJS files: $(find dist -name "*.js" | wc -l | tr -d ' ')"
  echo "  - ESM files: $(find dist -name "*.mjs" | wc -l | tr -d ' ')"
  echo "  - Type declaration files: $(find dist -name "*.d.ts" | wc -l | tr -d ' ')"
fi

# Clean up temporary directory
rm -rf dist-esm

echo "🎉 Ready to publish!"