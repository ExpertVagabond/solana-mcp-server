#!/usr/bin/env node

import { spawn } from 'child_process';
import { createInterface } from 'readline';

// Test the Solana MCP server
const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

// Test commands
const testCommands = [
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
      arguments: {
        name: "test-wallet"
      }
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
  }
];

let commandIndex = 0;

server.stdout.on('data', (data) => {
  console.log('Server response:', data.toString());
});

server.stderr.on('data', (data) => {
  console.log('Server error:', data.toString());
});

server.on('close', (code) => {
  console.log(`Server exited with code ${code}`);
  process.exit(0);
});

// Send test commands
function sendNextCommand() {
  if (commandIndex < testCommands.length) {
    const command = testCommands[commandIndex];
    console.log(`\nSending command ${commandIndex + 1}:`, JSON.stringify(command, null, 2));
    server.stdin.write(JSON.stringify(command) + '\n');
    commandIndex++;
    
    // Wait a bit before sending next command
    setTimeout(sendNextCommand, 2000);
  } else {
    console.log('\nAll test commands sent. Closing server...');
    setTimeout(() => {
      server.kill();
    }, 1000);
  }
}

// Start sending commands after a short delay
setTimeout(sendNextCommand, 1000);