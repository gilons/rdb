#!/bin/bash
set -e

# Version management script for RDB SDK
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Function to show usage
usage() {
  echo "Usage: $0 <patch|minor|major|version>"
  echo ""
  echo "Examples:"
  echo "  $0 patch    # 1.0.0 -> 1.0.1"
  echo "  $0 minor    # 1.0.0 -> 1.1.0"  
  echo "  $0 major    # 1.0.0 -> 2.0.0"
  echo "  $0 1.2.3    # Set specific version"
  echo ""
  exit 1
}

# Check if argument is provided
if [ $# -eq 0 ]; then
  echo "❌ No version type specified."
  usage
fi

VERSION_TYPE=$1

# Current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "📋 Current version: $CURRENT_VERSION"

# Calculate new version
case $VERSION_TYPE in
  patch|minor|major)
    NEW_VERSION=$(npm version $VERSION_TYPE --no-git-tag-version)
    NEW_VERSION=${NEW_VERSION#v}  # Remove 'v' prefix
    ;;
  *)
    # Assume it's a specific version number
    if [[ $VERSION_TYPE =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      NEW_VERSION=$VERSION_TYPE
      npm version $NEW_VERSION --no-git-tag-version
    else
      echo "❌ Invalid version format: $VERSION_TYPE"
      usage
    fi
    ;;
esac

echo "🔄 Updated version: $NEW_VERSION"

# Update package.json
echo "📝 Updating package.json..."

# Build to make sure everything works
echo "🔨 Building with new version..."
npm run build

echo "✅ Version updated successfully!"
echo ""
echo "📝 Next steps:"
echo "  1. Review the changes: git diff"
echo "  2. Commit: git add . && git commit -m \"chore: bump version to $NEW_VERSION\""
echo "  3. Push: git push origin main"
echo "  4. Publish: ./publish.sh"
echo ""