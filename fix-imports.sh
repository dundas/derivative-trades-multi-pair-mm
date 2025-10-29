#!/bin/bash

# Script to fix import paths in the Multi-Pair standalone repository
# This updates paths from the monorepo structure to the standalone structure

REPO_DIR="/Users/kefentse/dev_env/derivative-trades-multi-pair-mm"

echo "Fixing import paths in Multi-Pair repository..."
echo "================================================"

# Fix pattern 1: src/core/ files - ../utils/ -> ../../utils/
echo "Fixing utils imports in src/core/..."
find "$REPO_DIR/src/core" -name "*.js" -type f -exec sed -i '' \
  "s|from '../utils/|from '../../utils/|g" {} \;

# Fix pattern 2: src/core/ files - ../../../lib/ -> ../../lib/
echo "Fixing lib imports in src/core/..."
find "$REPO_DIR/src/core" -name "*.js" -type f -exec sed -i '' \
  "s|from '../../../lib/|from '../../lib/|g" {} \;

# Fix pattern 3: src/exchanges/ files - ../../../../lib/ -> ../../../lib/
echo "Fixing lib imports in src/exchanges/..."
find "$REPO_DIR/src/exchanges" -name "*.js" -type f -exec sed -i '' \
  "s|from '../../../../lib/|from '../../../lib/|g" {} \;

# Fix pattern 4: src/exchanges/ files - ../../../../utils/ -> ../../../lib/utils/
echo "Fixing utils imports in src/exchanges/..."
find "$REPO_DIR/src/exchanges" -name "*.js" -type f -exec sed -i '' \
  "s|from '../../../../utils/|from '../../../lib/utils/|g" {} \;

# Fix pattern 5: src/data/ files - ../../utils/ -> ../../../lib/utils/ (if they exist)
echo "Fixing utils imports in src/data/..."
find "$REPO_DIR/src/data" -name "*.js" -type f -exec sed -i '' \
  "s|from '../../utils/|from '../../../lib/utils/|g" {} \;

# Fix pattern 6: src/data/ files - ../../../../utils/ -> ../../../lib/utils/
find "$REPO_DIR/src/data" -name "*.js" -type f -exec sed -i '' \
  "s|from '../../../../utils/|from '../../../lib/utils/|g" {} \;

# Fix pattern 7: src/data/ files - ../../../../lib/ -> ../../../lib/
find "$REPO_DIR/src/data" -name "*.js" -type f -exec sed -i '' \
  "s|from '../../../../lib/|from '../../../lib/|g" {} \;

# Fix KrakenFuturesWebSocketClient path (remove /kraken-futures/ subdirectory)
echo "Fixing KrakenFuturesWebSocketClient imports..."
find "$REPO_DIR/src" -name "*.js" -type f -exec sed -i '' \
  "s|lib/exchanges/kraken-futures/KrakenFuturesWebSocketClient|lib/exchanges/KrakenFuturesWebSocketClient|g" {} \;

find "$REPO_DIR/src" -name "*.js" -type f -exec sed -i '' \
  "s|lib/exchanges/kraken-futures/KrakenFuturesRESTClient|lib/exchanges/KrakenFuturesRESTClient|g" {} \;

# Fix adapters path (remove /adapters/ subdirectory)
echo "Fixing adapter imports..."
find "$REPO_DIR/src" -name "*.js" -type f -exec sed -i '' \
  "s|lib/exchanges/adapters/KrakenPrivateWebSocketAdapter|lib/exchanges/KrakenPrivateWebSocketAdapter|g" {} \;

echo ""
echo "Import paths fixed successfully!"
echo "================================"
echo ""
echo "Summary of changes:"
echo "- Updated utils paths in src/core/ (../utils/ -> ../../utils/)"
echo "- Updated lib paths in src/core/ (../../../lib/ -> ../../lib/)"
echo "- Updated lib paths in src/exchanges/ (../../../../lib/ -> ../../../lib/)"
echo "- Updated utils paths in src/exchanges/ (../../../../utils/ -> ../../../lib/utils/)"
echo "- Updated paths in src/data/"
echo "- Fixed KrakenFuturesWebSocketClient paths (removed /kraken-futures/ subdirectory)"
echo "- Fixed adapter paths (removed /adapters/ subdirectory)"
