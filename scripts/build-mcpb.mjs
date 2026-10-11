#!/usr/bin/env node
// Build an MCP Bundle (.mcpb) for Smithery and one-click Claude Desktop install.
//
//   npm run build && npm run build:mcpb   ->   build/solana-mcp-server-<version>.mcpb
//
// Stages dist/ plus production-only node_modules, syncs manifest.json's version
// and tool list from the built server (so the manifest can't drift from the
// code), then packs with @anthropic-ai/mcpb.

import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const stage = mkdtempSync(join(tmpdir(), "solana-mcpb-"));
const out = join(root, "build", `${pkg.name}-${pkg.version}.mcpb`);

for (const f of ["dist", "package.json", "package-lock.json", "README.md", "LICENSE"]) {
  cpSync(join(root, f), join(stage, f), { recursive: true });
}
execFileSync("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: stage, stdio: "inherit" });

// Ask the staged server for its tools, exactly as a client would.
const server = spawn("node", [join(stage, "dist/index.js")], { stdio: ["pipe", "pipe", "ignore"] });
const lines = createInterface({ input: server.stdout });
const send = (msg) => server.stdin.write(JSON.stringify(msg) + "\n");
const tools = await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("server did not answer tools/list within 60s")), 60000);
  lines.on("line", (line) => {
    const msg = JSON.parse(line);
    if (msg.id === 1) {
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    } else if (msg.id === 2) {
      clearTimeout(timer);
      done(msg.result.tools);
    }
  });
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "build-mcpb", version: "0" } } });
});
server.kill();

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
manifest.version = pkg.version;
manifest.tools = tools.map(({ name, description }) => ({ name, description: description ?? "" }));
writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
cpSync(join(root, "manifest.json"), join(stage, "manifest.json"));

mkdirSync(join(root, "build"), { recursive: true });
execFileSync("npx", ["-y", "@anthropic-ai/mcpb", "pack", stage, out], { stdio: ["ignore", "ignore", "inherit"] });
rmSync(stage, { recursive: true, force: true });
console.log(`✅ ${out} (${tools.length} tools, v${pkg.version})`);
