#!/bin/bash

# TrueX FIX Simulation Setup Script
# This script helps set up and run the TrueX FIX trading simulation

set -e

echo "=== TrueX FIX Simulation Setup ==="
echo

# Check prerequisites
echo "Checking prerequisites..."

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "   Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

# Check Git
if ! command -v git &> /dev/null; then
    echo "❌ Git is not installed. Please install Git first."
    exit 1
fi

echo "✅ All prerequisites installed"
echo

# Setup directory
SIMULATION_DIR="./truex-fix-simulation"

# Clone or update repository
if [ -d "$SIMULATION_DIR" ]; then
    echo "Updating existing TrueX tools repository..."
    cd "$SIMULATION_DIR"
    git pull
else
    echo "Cloning TrueX tools repository..."
    git clone https://github.com/true-markets/tools.git "$SIMULATION_DIR"
    cd "$SIMULATION_DIR"
fi

# Initialize submodules
echo "Initializing Git submodules..."
git submodule init
git submodule update

# Navigate to fix_simulation
cd fix_simulation

# Check for .env file
if [ ! -f .env ]; then
    echo
    echo "⚠️  No .env file found. Creating template..."
    cat > .env.template << EOF
# TrueX FIX Simulation Environment Variables
# Copy this to .env and fill in your credentials

# Client identifiers (comma-separated)
TRUEX_CLIENT_MNEMONICS=client1,client2

# API credentials
TRUEX_CLIENT_API_KEY_ID=your_api_key_id_here
TRUEX_CLIENT_API_KEY_SECRET=your_api_key_secret_here
EOF
    
    echo "Created .env.template"
    echo "Please copy it to .env and add your credentials:"
    echo "  cp .env.template .env"
    echo "  # Edit .env with your credentials"
    echo
    read -p "Press Enter after you've created the .env file..."
fi

# Download FIX dictionaries for our adapter
echo
echo "Downloading FIX dictionaries for adapter integration..."
DICT_DIR="../../../specification"
mkdir -p "$DICT_DIR"

if [ ! -f "$DICT_DIR/TrueX_FIXT11.xml" ]; then
    echo "Downloading TrueX_FIXT11.xml..."
    curl -s https://raw.githubusercontent.com/true-markets/specification/develop/TrueX_FIXT11.xml > "$DICT_DIR/TrueX_FIXT11.xml"
fi

if [ ! -f "$DICT_DIR/TrueX_FIX50SP2.xml" ]; then
    echo "Downloading TrueX_FIX50SP2.xml..."
    curl -s https://raw.githubusercontent.com/true-markets/specification/develop/TrueX_FIX50SP2.xml > "$DICT_DIR/TrueX_FIX50SP2.xml"
fi

echo "✅ FIX dictionaries downloaded"

# Show next steps
echo
echo "=== Setup Complete ==="
echo
echo "To run the simulation:"
echo "  cd $SIMULATION_DIR/fix_simulation"
echo "  docker-compose up --build"
echo
echo "To stop the simulation:"
echo "  docker stop truex_fix_trade_simulation"
echo "  # Or press Ctrl+C"
echo
echo "UAT Connection Details:"
echo "  Host: uat1.truex.co"
echo "  Port: 19484"
echo "  Target: TRUEX_UAT_GW"
echo
echo "For our adapter testing, use the configuration in:"
echo "  TrueX-FIX-Simulation-Guide.md"
echo

# Optionally start the simulation
read -p "Would you like to start the simulation now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Starting TrueX FIX simulation..."
    docker-compose up --build
fi