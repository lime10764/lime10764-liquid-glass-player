#!/bin/bash
# Deploy to GitHub Pages
# Usage: ./deploy.sh <github-username> [repo-name]

set -e

USERNAME="${1:?Usage: $0 <github-username> [repo-name]}"
REPO="${2:-liquid-glass-player}"

echo "Deploying to $USERNAME/$REPO ..."

if [ ! -d .git ]; then
  git init
fi

git add .
git commit -m "Deploy liquid glass player" || echo "Nothing to commit"

git branch -M main

REMOTE="https://github.com/$USERNAME/$REPO.git"
git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE"

git push -u origin main

echo ""
echo "Done. Enable GitHub Pages at:"
echo "  https://github.com/$USERNAME/$REPO/settings/pages"
echo "Then visit: https://$USERNAME.github.io/$REPO/"
