#!/usr/bin/env node
/**
 * Solana MCP Server — Integration Test Harness
 *
 * Validates JSON-RPC protocol compliance, input sanitization, and graceful
 * error handling before the server binary is published. All test payloads
 * are validated locally before transmission.
 *
 * Security: This file never touches real wallets or mainnet RPC endpoints.
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { existsSync } from 'fs';

// ── Input Validation Helpers ──────────────────────────────────────────────────

/** Validate a JSON-RPC 2.0 request structure before sending */
function validateJsonRpcRequest(req) {
  if (!req || typeof req !== 'object') {
    throw new Error('Request must be a non-null object');
  }
  if (req.jsonrpc !== '2.0') {
    throw new Error(`Invalid jsonrpc version: expected "2.0", got "${req.jsonrpc}"`);
  }
  if (req.id !== undefined && typeof req.id !== 'number' && typeof req.id !== 'string') {
    throw new Error(`Invalid id type: ${typeof req.id}`);
  }
  if (!req.method || typeof req.method !== 'string') {
    throw new Error('Method must be a non-empty string');
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_/]*$/.test(req.method)) {
    throw new Error(`Invalid method name: ${req.method}`);
  }
  if (req.params !== undefined && typeof req.params !== 'object') {
    throw new Error('Params must be an object if provided');
  }
  return true;
}

/** Sanitize string fields — strip control characters */
function sanitizeString(val) {
  if (typeof val !== 'string') return val;
  // eslint-disable-next-line no-control-regex
  return val.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/** Deep-sanitize all string values in a JSON-RPC request */
function sanitizeRequest(obj) {
  if (typeof obj === 'string') return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeRequest);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[sanitizeString(k)] = sanitizeRequest(v);
    }
    return out;
  }
  return obj;
}

/** Validate server response is parseable JSON with expected structure */
function validateServerResponse(raw) {
  if (!raw || typeof raw !== 'string') return { valid: false, error: 'Empty response' };
  try {
    const parsed = JSON.parse(raw.trim());
    if (typeof parsed !== 'object' || parsed === null) {
      return { valid: false, error: 'Response is not an object' };
    }
    if (parsed.jsonrpc && parsed.jsonrpc !== '2.0') {
      return { valid: false, error: `Unexpected jsonrpc version: ${parsed.jsonrpc}` };
    }
    return { valid: true, data: parsed };
  } catch (e) {
    return { valid: false, error: `JSON parse error: ${e.message}` };
  }
}

// ── Configuration & Limits ────────────────────────────────────────────────────

const MAX_COMMANDS = 50;
const COMMAND_INTERVAL_MS = 2000;
const SERVER_START_DELAY_MS = 1000;
const SHUTDOWN_GRACE_MS = 1000;
const SERVER_TIMEOUT_MS = 60_000;
const SERVER_BINARY = 'dist/index.js';

// Verify the server binary exists before spawning
if (!existsSync(SERVER_BINARY)) {
  console.error(`[FATAL] Server binary not found: ${SERVER_BINARY}`);
  console.error('Run "npm run build" first.');
  process.exit(1);
}

// ── Test Commands ─────────────────────────────────────────────────────────────

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
].slice(0, MAX_COMMANDS);

// Pre-validate and sanitize all commands
for (const cmd of testCommands) {
  validateJsonRpcRequest(cmd);
}
const sanitizedCommands = testCommands.map(sanitizeRequest);

// ── Server Process ────────────────────────────────────────────────────────────

const server = spawn('node', [SERVER_BINARY], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'test' },
});

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

let commandIndex = 0;
let responseCount = 0;
let errorCount = 0;

// Global timeout — kill server if tests hang
const globalTimeout = setTimeout(() => {
  console.error(`[TIMEOUT] Test harness exceeded ${SERVER_TIMEOUT_MS}ms — killing server`);
  server.kill('SIGTERM');
  process.exit(2);
}, SERVER_TIMEOUT_MS);

server.stdout.on('data', (data) => {
  const raw = data.toString();
  const result = validateServerResponse(raw);
  responseCount++;
  if (result.valid) {
    console.log(`[RESPONSE ${responseCount}]`, JSON.stringify(result.data, null, 2));
  } else {
    console.warn(`[WARN] Invalid server response: ${result.error}`);
    console.warn('  Raw:', raw.slice(0, 200));
    errorCount++;
  }
});

server.stderr.on('data', (data) => {
  const msg = data.toString().trim();
  if (msg) console.log('[SERVER STDERR]', msg.slice(0, 500));
});

server.on('close', (code) => {
  clearTimeout(globalTimeout);
  console.log(`\n[DONE] Server exited with code ${code}`);
  console.log(`  Responses: ${responseCount}, Errors: ${errorCount}`);
  process.exit(errorCount > 0 ? 1 : 0);
});

server.on('error', (err) => {
  clearTimeout(globalTimeout);
  console.error(`[FATAL] Failed to spawn server: ${err.message}`);
  process.exit(1);
});

// Send test commands sequentially
function sendNextCommand() {
  if (commandIndex < sanitizedCommands.length) {
    const command = sanitizedCommands[commandIndex];
    console.log(`\n[SEND ${commandIndex + 1}/${sanitizedCommands.length}]`, JSON.stringify(command, null, 2));
    server.stdin.write(JSON.stringify(command) + '\n');
    commandIndex++;
    setTimeout(sendNextCommand, COMMAND_INTERVAL_MS);
  } else {
    console.log('\n[INFO] All test commands sent. Shutting down server...');
    setTimeout(() => {
      server.kill('SIGTERM');
    }, SHUTDOWN_GRACE_MS);
  }
}

// Start sending commands after server initialization
setTimeout(sendNextCommand, SERVER_START_DELAY_MS);