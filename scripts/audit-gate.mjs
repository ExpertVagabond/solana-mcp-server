#!/usr/bin/env node
// Fails on any npm advisory at or above the configured severity threshold that is
// not explicitly accepted in .github/audit-allowlist.json.
//
// Why this exists instead of a plain `npm audit --audit-level moderate`:
// every advisory in this tree is transitive through @solana/web3.js v1 and
// @coral-xyz/anchor, and npm's only offered "fix" is a semver-major DOWNGRADE
// (web3.js@0.0.3, spl-token@0.1.8). A blanket audit can therefore never pass,
// so it stopped being a signal. This gate stays red for anything new.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

const config = JSON.parse(
  readFileSync(resolve(ROOT, ".github/audit-allowlist.json"), "utf8"),
);
const threshold = RANK[config.threshold ?? "moderate"];
const allowed = new Map(config.allow.map((entry) => [entry.id, entry]));

// `npm audit` exits non-zero when it finds anything, so capture rather than throw.
let raw;
try {
  raw = execFileSync("npm", ["audit", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
} catch (error) {
  raw = error.stdout;
  if (!raw) {
    console.error("npm audit produced no output:", error.message);
    process.exit(2);
  }
}

const report = JSON.parse(raw);

// Collapse the per-package view into unique root advisories. One advisory can be
// reported against several packages via different dependency paths.
const advisories = new Map();
for (const [pkg, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== "object") continue;
    const id = String(via.url ?? "").split("/").pop();
    if (!id) continue;
    if (!advisories.has(id)) {
      advisories.set(id, {
        id,
        severity: via.severity ?? vuln.severity,
        title: via.title ?? "",
        packages: new Set(),
      });
    }
    advisories.get(id).packages.add(via.name ?? pkg);
  }
}

const today = new Date().toISOString().slice(0, 10);
const unexpected = [];
const expired = [];

for (const advisory of advisories.values()) {
  if (RANK[advisory.severity] < threshold) continue;
  const entry = allowed.get(advisory.id);
  if (!entry) {
    unexpected.push(advisory);
  } else if (entry.expires && entry.expires < today) {
    expired.push({ ...advisory, expires: entry.expires });
  }
}

// A listed advisory that no longer appears means the allowlist can be trimmed.
const stale = [...allowed.keys()].filter((id) => !advisories.has(id));

const describe = (a) =>
  `  ${a.severity.padEnd(8)} ${a.id}  ${[...a.packages].join(", ")}\n` +
  (a.title ? `           ${a.title}\n` : "");

if (stale.length) {
  console.log(`Allowlist entries no longer present (safe to remove): ${stale.join(", ")}\n`);
}

if (expired.length) {
  console.error("Allowlist entries have expired and need re-review:");
  for (const a of expired) console.error(describe(a).trimEnd() + `  (expired ${a.expires})`);
  console.error("");
}

if (unexpected.length) {
  console.error(`New advisories at or above "${config.threshold}" severity:`);
  for (const a of unexpected) process.stderr.write(describe(a));
  console.error("Fix the dependency, or add the advisory to .github/audit-allowlist.json with a reason and an expiry.");
}

if (unexpected.length || expired.length) process.exit(1);

console.log(
  `Audit gate passed: ${advisories.size} advisories, ${allowed.size} accepted with a documented reason, 0 new at or above "${config.threshold}".`,
);
