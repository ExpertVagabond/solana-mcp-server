# solana-mcp-server

[![npm version](https://img.shields.io/npm/v/solana-mcp-server)](https://www.npmjs.com/package/solana-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-339933?logo=node.js)](https://nodejs.org)
[![Tools](https://img.shields.io/badge/tools-25-blue)](https://modelcontextprotocol.io)

**Full Solana blockchain MCP server.** 25 tools for wallet management, SPL token operations, DeFi, staking, and network queries. Built on `@solana/web3.js` and `@solana/spl-token` with Anchor support.

The most actively maintained Solana MCP. Covers the complete SPL token lifecycle (create, mint, burn, freeze, thaw, delegate, authority management) that competitors skip.

## Install

```bash
npx solana-mcp-server
```

Or install globally:

```bash
npm install -g solana-mcp-server
solana-mcp-server
```

## Configure

Add to your MCP config (`claude_desktop_config.json` or `~/.mcp.json`):

```json
{
  "mcpServers": {
    "solana": {
      "command": "npx",
      "args": ["-y", "solana-mcp-server"],
      "env": {
        "SOLANA_RPC_URL": "https://api.mainnet-beta.solana.com"
      }
    }
  }
}
```

## Tools (25)

### Wallet Management (4)

| Tool | Description | Key Params |
|------|-------------|------------|
| `create_wallet` | Create a new Solana keypair (in-memory only) | -- |
| `import_wallet` | Import from a base58-encoded private key | `privateKey` |
| `list_wallets` | List all wallets in the current session | -- |
| `get_balance` | Get SOL balance for any address | `address` |

### SPL Token Operations (10)

| Tool | Description | Key Params |
|------|-------------|------------|
| `create_spl_token` | Create a new SPL token with custom decimals | `walletName`, `decimals` |
| `mint_tokens` | Mint tokens to any address | `walletName`, `tokenMint`, `amount` |
| `burn_tokens` | Burn tokens from an account | `walletName`, `tokenMint`, `amount` |
| `freeze_account` | Freeze a token account | `walletName`, `tokenMint`, `accountAddress` |
| `thaw_account` | Unfreeze a token account | `walletName`, `tokenMint`, `accountAddress` |
| `set_token_authority` | Change token authority (mint, freeze, owner, close) | `walletName`, `tokenMint`, `authorityType` |
| `get_token_supply` | Total supply and metadata for a token | `tokenMint` |
| `close_token_account` | Close an account and reclaim rent | `walletName`, `tokenAccount` |
| `approve_delegate` | Approve a delegate for token transfers | `walletName`, `tokenAccount`, `delegate`, `amount` |
| `revoke_delegate` | Revoke delegate approval | `walletName`, `tokenAccount` |

### Transfers (3)

| Tool | Description | Key Params |
|------|-------------|------------|
| `transfer_sol` | Transfer SOL between wallets | `from`, `to`, `amount` |
| `transfer_tokens` | Transfer SPL tokens | `from`, `to`, `tokenMint`, `amount` |
| `airdrop_sol` | Request SOL airdrop (devnet/testnet only) | `address`, `amount` |

### Account Queries (4)

| Tool | Description | Key Params |
|------|-------------|------------|
| `get_account_info` | Detailed account information | `address` |
| `get_transaction` | Transaction details by signature | `signature` |
| `create_token_account` | Create an associated token account | `walletName`, `tokenMint` |
| `get_token_accounts` | List all token accounts for a wallet | `address` |

### Token Data (1)

| Tool | Description | Key Params |
|------|-------------|------------|
| `get_token_balance` | SPL token balance for a specific account | `address`, `tokenMint` |

### Network (3)

| Tool | Description | Key Params |
|------|-------------|------------|
| `switch_network` | Switch between mainnet, devnet, testnet, localhost | `network` |
| `get_network_info` | Current network status and info | -- |
| `get_recent_blockhash` | Recent blockhash for transaction building | -- |

## Why This One?

- **Complete SPL token lifecycle.** Create, mint, burn, freeze, thaw, set authority, delegate, close -- 10 token tools covering every operation. Competitors stop at create/transfer.
- **Production-ready infrastructure.** Lazy connection initialization (no startup timeouts), 10-second network call timeouts, comprehensive error handling, and Smithery deployment support.
- **Anchor integration.** Built with `@coral-xyz/anchor` support for interacting with Anchor programs alongside raw SPL token operations.

## Networks

| Network | Endpoint |
|---------|----------|
| `mainnet` | `https://api.mainnet-beta.solana.com` |
| `devnet` | `https://api.devnet.solana.com` |
| `testnet` | `https://api.testnet.solana.com` |
| `localhost` | `http://127.0.0.1:8899` |

## Security

- Private keys stored in memory only -- never persisted to disk
- Keys cleared on process exit
- All inputs validated with Zod schemas

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SOLANA_RPC_URL` | No | Solana RPC endpoint (default: mainnet) |

## Development

```bash
git clone https://github.com/ExpertVagabond/solana-mcp-server.git
cd solana-mcp-server
npm install
npm run build
npm start
```

```bash
npm test              # Basic functionality tests
npm run type-check    # TypeScript type checking
npm run lint          # ESLint
npm run quality       # Full quality check (lint + types + tests)
```

## License

MIT -- [Purple Squirrel Media](https://github.com/ExpertVagabond)

## Hosted deployment

A hosted deployment is available on [Fronteir AI](https://fronteir.ai/mcp/expertvagabond-solana-mcp-server).

