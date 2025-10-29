#!/bin/bash

# Setup script for TrueX FIX Exchange Adapter

echo "Setting up TrueX FIX Exchange Adapter dependencies..."

# Navigate to project root
cd ../../../../

# Install jspurefix
echo "Installing jspurefix..."
npm install jspurefix

# Navigate to jspurefix module and unzip repository data
cd node_modules/jspurefix
npm run unzip-repo
cd ../..

# Create directory for FIX dictionaries if it doesn't exist
mkdir -p src/services/market-maker/utils/exchange/fix-dictionaries

# Download FIX 5.0 SP2 dictionary from QuickFIX
echo "Downloading FIX 5.0 SP2 dictionary..."
curl -o src/services/market-maker/utils/exchange/fix-dictionaries/FIX50SP2.xml \
  https://raw.githubusercontent.com/quickfix/quickfix/master/spec/FIX50SP2.xml

echo "Setup complete!"
echo ""
echo "Next steps:"
echo "1. Configure your TrueX API credentials"
echo "2. Update the dictionary path in your adapter configuration if needed"
echo "3. Review the TrueXFIXExchangeAdapter.v2.js for the jspurefix-based implementation"
echo ""
echo "Example usage:"
echo "  import { TrueXFIXExchangeAdapter } from './TrueXFIXExchangeAdapter.v2.js';"
echo "  const adapter = new TrueXFIXExchangeAdapter(config);"
echo "  await adapter.connect();"