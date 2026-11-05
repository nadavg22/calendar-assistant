#!/bin/sh
# Pushes the backend and updates the live web app, keeping the same URL.
set -e
cd "$(dirname "$0")/.."
npx clasp push --force
npx clasp update-deployment "$(cat .deployment-id)" --description "$(date '+%Y-%m-%d %H:%M')"
