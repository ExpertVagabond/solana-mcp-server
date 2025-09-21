#!/usr/bin/env node

import { spawn } from 'child_process';
import { createInterface } from 'readline';

console.log('🚀 Starting Comprehensive Solana MCP Server Test\n');

// Test the Solana MCP server
const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let testResults = [];
let testIndex = 0;

const tests = [
  {
    name: "List Available Tools",
    command: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {}
    },
    expected: "tools"
  },
  {
    name: "Create Test Wallet",
    command: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "create_wallet",
        arguments: {
          name: "test-wallet-1"
        }
      }
    },
    expected: "success"
  },
  {
    name: "Create Second Wallet",
    command: {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "create_wallet",
        arguments: {
          name: "test-wallet-2"
        }
      }
    },
    expected: "success"
  },
  {
    name: "List All Wallets",
    command: {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "list_wallets",
        arguments: {}
      }
    },
    expected: "wallets"
  },
  {
    name: "Get Network Information",
    command: {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "get_network_info",
        arguments: {}
      }
    },
    expected: "network"
  },
  {
    name: "Get Wallet Balance",
    command: {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "get_balance",
        arguments: {
          walletName: "test-wallet-1"
        }
      }
    },
    expected: "balance"
  },
  {
    name: "Request SOL Airdrop",
    command: {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "airdrop_sol",
        arguments: {
          walletName: "test-wallet-1",
          amount: 1
        }
      }
    },
    expected: "signature"
  },
  {
    name: "Get Recent Blockhash",
    command: {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "get_recent_blockhash",
        arguments: {}
      }
    },
    expected: "blockhash"
  },
  {
    name: "Switch to Mainnet",
    command: {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "switch_network",
        arguments: {
          network: "mainnet"
        }
      }
    },
    expected: "success"
  },
  {
    name: "Get Token Accounts",
    command: {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "get_token_accounts",
        arguments: {
          walletName: "test-wallet-1"
        }
      }
    },
    expected: "tokenAccounts"
  }
];

server.stdout.on('data', (data) => {
  const response = JSON.parse(data.toString());
  const test = tests[testIndex];
  
  if (response.result) {
    let parsedResult;
    if (response.result.content && response.result.content[0]) {
      const result = response.result.content[0].text;
      parsedResult = JSON.parse(result);
    } else if (response.result.tools) {
      parsedResult = response.result;
    } else {
      parsedResult = response.result;
    }
    
    let passed = false;
    if (test.expected === "tools" && parsedResult.tools) passed = true;
    else if (test.expected === "success" && parsedResult.success) passed = true;
    else if (test.expected === "wallets" && parsedResult.wallets) passed = true;
    else if (test.expected === "network" && parsedResult.network) passed = true;
    else if (test.expected === "balance" && parsedResult.balance) passed = true;
    else if (test.expected === "signature" && parsedResult.signature) passed = true;
    else if (test.expected === "blockhash" && parsedResult.blockhash) passed = true;
    else if (test.expected === "tokenAccounts" && parsedResult.tokenAccounts) passed = true;
    
    testResults.push({
      name: test.name,
      passed,
      result: parsedResult
    });
    
    console.log(`${passed ? '✅' : '❌'} ${test.name}`);
    if (!passed) {
      console.log(`   Expected: ${test.expected}`);
      console.log(`   Got: ${JSON.stringify(parsedResult, null, 2)}`);
    }
  } else if (response.error) {
    testResults.push({
      name: test.name,
      passed: false,
      error: response.error
    });
    console.log(`❌ ${test.name} - Error: ${response.error.message}`);
  }
});

server.stderr.on('data', (data) => {
  console.log('Server error:', data.toString());
});

server.on('close', (code) => {
  console.log(`\n🏁 Server exited with code ${code}`);
  
  const passedTests = testResults.filter(t => t.passed).length;
  const totalTests = testResults.length;
  
  console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! Solana MCP Server is working perfectly!');
  } else {
    console.log('⚠️  Some tests failed. Check the output above for details.');
  }
  
  process.exit(0);
});

// Send test commands
function sendNextTest() {
  if (testIndex < tests.length) {
    const test = tests[testIndex];
    console.log(`\n🧪 Running: ${test.name}`);
    server.stdin.write(JSON.stringify(test.command) + '\n');
    testIndex++;
    
    // Wait before sending next test
    setTimeout(sendNextTest, 2000);
  } else {
    console.log('\n✨ All tests completed. Closing server...');
    setTimeout(() => {
      server.kill();
    }, 1000);
  }
}

// Start running tests after a short delay
setTimeout(sendNextTest, 1000);