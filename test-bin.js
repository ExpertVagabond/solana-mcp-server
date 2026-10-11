#!/usr/bin/env node

// Launch the server the way npx and global installs do: through a symlink
// named after the bin, not through dist/index.js. 1.1.0 shipped exiting
// silently on this path because its main-module check matched "index.js".

import { spawn } from 'child_process';
import { mkdtempSync, symlinkSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const dir = mkdtempSync(join(tmpdir(), 'solana-mcp-bin-'));
const bin = join(dir, 'solana-mcp-server');
symlinkSync(resolve('dist/index.js'), bin);

const server = spawn('node', [bin], { stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '';

const finish = (ok, message) => {
  console.log(`${ok ? '✅' : '❌'} bin symlink: ${message}`);
  server.kill();
  rmSync(dir, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
};

const timer = setTimeout(() => finish(false, 'no initialize response within 15s'), 15000);

server.stdout.on('data', (data) => {
  buffer += data.toString();
  for (const line of buffer.split('\n').slice(0, -1)) {
    const response = JSON.parse(line);
    if (response.id === 1) {
      clearTimeout(timer);
      finish(Boolean(response.result), `initialize -> ${JSON.stringify(response.result?.serverInfo ?? response.error)}`);
    }
  }
  buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
});

server.on('exit', (code) => {
  clearTimeout(timer);
  finish(false, `server exited (code ${code}) before answering initialize`);
});

server.stdin.write(JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-bin', version: '0' } }
}) + '\n');
