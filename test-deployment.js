#!/usr/bin/env node

import { spawn } from 'child_process';

console.log('🚀 Testing Solana MCP Server Deployment Readiness\n');

// Test the server startup time
const startTime = Date.now();
const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let serverReady = false;
let testResults = [];

server.stdout.on('data', (data) => {
  if (!serverReady) {
    const startupTime = Date.now() - startTime;
    console.log(`✅ Server started in ${startupTime}ms`);
    serverReady = true;
    
    // Test basic functionality
    testBasicFunctionality();
  }
  
  try {
    const response = JSON.parse(data.toString());
    if (response.result) {
      testResults.push({ success: true, response });
      console.log('✅ Command executed successfully');
    }
  } catch (e) {
    // Ignore non-JSON output
  }
});

server.stderr.on('data', (data) => {
  const message = data.toString();
  if (message.includes('Solana MCP server running')) {
    console.log('📡 Server is running and ready');
  }
});

server.on('close', (code) => {
  const totalTime = Date.now() - startTime;
  console.log(`\n📊 Deployment Test Results:`);
  console.log(`- Server startup time: ${Date.now() - startTime}ms`);
  console.log(`- Successful commands: ${testResults.length}`);
  console.log(`- Exit code: ${code}`);
  
  if (code === 0 && testResults.length > 0) {
    console.log('🎉 Server is deployment-ready!');
  } else {
    console.log('⚠️  Server may have issues during deployment');
  }
  
  process.exit(0);
});

function testBasicFunctionality() {
  // Test 1: List tools
  setTimeout(() => {
    console.log('🧪 Testing tool listing...');
    server.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {}
    }) + '\n');
  }, 100);
  
  // Test 2: Create wallet
  setTimeout(() => {
    console.log('🧪 Testing wallet creation...');
    server.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "create_wallet",
        arguments: { name: "deployment-test" }
      }
    }) + '\n');
  }, 500);
  
  // Close server after tests
  setTimeout(() => {
    console.log('🏁 Tests completed, closing server...');
    server.kill();
  }, 2000);
}

// Handle server startup timeout
setTimeout(() => {
  if (!serverReady) {
    console.log('❌ Server failed to start within 10 seconds');
    server.kill();
    process.exit(1);
  }
}, 10000);