#!/bin/bash

echo "📱 gChat Termux Setup"
echo "======================"
echo "Installing system dependencies for native module compilation (SQLite3)..."

# switch to stable-repo if needed, but usually default is fine
pkg update -y

# Install Python, Make, and Clang (required for node-gyp/sqlite3 build)
pkg install -y python python-pip make clang build-essential git nodejs-lts

echo "✅ System dependencies installed."
echo "Installing Node.js packages..."

# Remove potentially broken modules from a previous attempt
rm -rf node_modules package-lock.json

# Install with build flags if needed, but standard install usually picks up the tools now
npm install

echo "🎉 Installation Complete!"
echo "Run 'npm start' to launch gChat."
