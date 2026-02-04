#!/bin/bash
set -e

# Install yt-dlp
echo "Installing yt-dlp..."
pip3 install yt-dlp

# Create bin directory
mkdir -p bin

# Download and install aria2c static binary
if [ ! -f "bin/aria2c" ]; then
  echo "Downloading aria2c..."
  # Download static binary (Linux x64)
  curl -L -o bin/aria2c https://github.com/q3aql/aria2-static-builds/releases/download/v1.36.0/aria2-1.36.0-linux-gnu-64bit-build1
  chmod +x bin/aria2c
  echo "aria2c installed successfully"
else
  echo "aria2c already installed"
fi
