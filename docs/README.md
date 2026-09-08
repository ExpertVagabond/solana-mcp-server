# solana-mcp-server Documentation

Welcome to the documentation for solana-mcp-server.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Contributing](#contributing)

## Installation

```bash
npm install
```

## Usage

Basic usage examples will be documented here.

## API Reference

API documentation will be available here.

## Security advisories

CI does not run a bare `npm audit`. Every advisory in this dependency tree is
transitive through `@solana/web3.js` v1 or `@coral-xyz/anchor`, and the only fix
npm offers is a semver-major downgrade to `@solana/web3.js@0.0.3` /
`@solana/spl-token@0.1.8`, which would remove token-2022 support and break most
of the tools here. A gate that can never pass is not a gate.

Instead, `scripts/audit-gate.mjs` fails the build on any advisory at or above the
configured severity that is **not** listed in `.github/audit-allowlist.json`.
Each accepted advisory carries a reachability rationale and an expiry date;
expired entries fail the build so the list cannot rot unnoticed, and entries that
no longer appear are reported as safe to delete.

To accept a new advisory, add it to that file with a real reason — not just an ID.

```bash
node scripts/audit-gate.mjs
```

## Contributing

Please see our [Contributing Guidelines](../CONTRIBUTING.md) for details.
