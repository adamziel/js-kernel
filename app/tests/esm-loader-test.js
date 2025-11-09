#!/usr/bin/env node

// Test file to verify ESM loader functionality
// This file tests whether the ModuleWrap implementation can handle basic ESM imports

console.log('[ESM Test] Starting ESM loader test');

// Test 1: Basic require (should always work via CJS)
try {
    const fs = require('fs');
    console.log('[ESM Test] ✓ Basic require works:', typeof fs.readFileSync);
} catch (error) {
    console.error('[ESM Test] ✗ Basic require failed:', error.message);
}

// Test 2: Dynamic import (this is what triggers ModuleWrap.evaluate)
async function testDynamicImport() {
    try {
        console.log('[ESM Test] Attempting dynamic import...');
        // Try to import a core module
        const pathModule = await import('path');
        console.log('[ESM Test] ✓ Dynamic import works:', typeof pathModule.join);
        return true;
    } catch (error) {
        console.error('[ESM Test] ✗ Dynamic import failed:', error.message);
        console.error('[ESM Test] This is expected if ESM is not fully implemented');
        return false;
    }
}

// Test 3: Check if we can detect ESM mode
console.log('[ESM Test] Module type check:');
console.log('[ESM Test] - typeof module:', typeof module);
console.log('[ESM Test] - typeof exports:', typeof exports);
console.log('[ESM Test] - typeof require:', typeof require);

// Run async tests
async function runTests() {
    console.log('\n[ESM Test] Running async tests...\n');

    await testDynamicImport();

    console.log('\n[ESM Test] Tests complete');
    process.exit(0);
}

runTests().catch((error) => {
    console.error('[ESM Test] Test suite failed:', error);
    process.exit(1);
});
