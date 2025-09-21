# Solana MCP Server

A Model Context Protocol (MCP) server for Solana blockchain interactions, providing comprehensive wallet management, transaction handling, and program interactions.

## Features

### Wallet Management
- Create new Solana wallets
- Import existing wallets from private keys
- List all managed wallets
- Get wallet balances (SOL and SPL tokens)

### Transaction Operations
- Transfer SOL between wallets
- Transfer SPL tokens
- Request SOL airdrops (devnet/testnet only)
- Get transaction details by signature

### Account Management
- Get detailed account information
- Create associated token accounts
- List all token accounts for a wallet
- Get token balances

### Network Operations
- Switch between Solana networks (mainnet, devnet, testnet, localhost)
- Get network information and status
- Get recent blockhash for transaction building

## Installation

```bash
npm install
npm run build
```

## Usage

### Start the server
```bash
npm start
```

### Available Commands

#### Wallet Management
- `create_wallet` - Create a new Solana wallet
- `import_wallet` - Import existing wallet from private key
- `list_wallets` - List all managed wallets
- `get_balance` - Get SOL balance for a wallet
- `get_token_balance` - Get SPL token balance

#### Transactions
- `transfer_sol` - Transfer SOL between wallets
- `transfer_tokens` - Transfer SPL tokens
- `airdrop_sol` - Request SOL airdrop (devnet/testnet only)

#### Account Operations
- `get_account_info` - Get detailed account information
- `get_transaction` - Get transaction details by signature
- `create_token_account` - Create associated token account
- `get_token_accounts` - List all token accounts for a wallet

#### Network Operations
- `switch_network` - Switch Solana network
- `get_network_info` - Get current network information
- `get_recent_blockhash` - Get recent blockhash

## Supported Networks

- **Mainnet**: Production Solana network
- **Devnet**: Development network with free SOL airdrops
- **Testnet**: Testing network
- **Localhost**: Local Solana validator

## Security Notes

- Private keys are stored in memory only (not persisted)
- For production use, implement secure key storage
- Never share private keys or commit them to version control

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in development mode
npm run dev
```

## License

MIT