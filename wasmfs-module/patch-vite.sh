#!/bin/bash

# Patch the generated JS file to add @vite-ignore comments for Vite compatibility

echo "Patching wasmfs-fs.js for Vite compatibility..."

# Find and patch all Worker() instantiations with new URL()
sed -i 's/new Worker(new URL/new Worker(\/* @vite-ignore *\/ new URL/g' /src/dist/wasmfs-fs.js
sed -i 's/import\.meta\.url), {/import.meta.url), \/* @vite-ignore *\/ {/g' /src/dist/wasmfs-fs.js

echo "Patching complete!"
