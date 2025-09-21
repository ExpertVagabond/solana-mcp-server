#!/usr/bin/env node

import { spawn } from 'child_process';

console.log('🚀 Testing Solana MCP Server - Basic Functionality\n');

const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let testCount = 0;
let passedTests = 0;

server.stdout.on('data', (data) => {
  const response = JSON.parse(data.toString());
  testCount++;
  
  if (response.result) {
    console.log(`✅ Test ${testCount} passed`);
    passedTests++;
  } else if (response.error) {
    console.log(`❌ Test ${testCount} failed:`, response.error.message);
  }
});

server.stderr.on('data', (data) => {
  // Ignore server startup messages
});

server.on('close', (code) => {
  console.log(`\n📊 Results: ${passedTests}/${testCount} tests passed`);
  if (passedTests === testCount) {
    console.log('🎉 All tests passed! Solana MCP Server is working!');
  }
  process.exit(0);
});

// Test commands
const tests = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {}
  },
  {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "create_wallet",
      arguments: { name: "test-wallet" }
    }
  },
  {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "list_wallets",
      arguments: {}
    }
  },
  {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "get_network_info",
      arguments: {}
    }
  },
  {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "get_balance",
      arguments: { walletName: "test-wallet" }
    }
  }
];

// Send tests with delays
tests.forEach((test, index) => {
  setTimeout(() => {
    console.log(`🧪 Running test ${index + 1}...`);
    server.stdin.write(JSON.stringify(test) + '\n');
  }, index * 1000);
});

// Close after all tests
setTimeout(() => {
  server.kill();
}, tests.length * 1000 + 2000);