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

### SPL Token Operations (CLI Integration)
- Create new SPL tokens with custom decimals
- Mint tokens to any wallet address
- Burn tokens from accounts
- Freeze/thaw token accounts
- Set and manage token authorities (mint, freeze, account owner, close)
- Get token supply information
- Close token accounts and reclaim rent
- Approve/revoke delegates for token operations

### Network Operations
- Switch between Solana networks (mainnet, devnet, testnet, localhost)
- Get network information and status
- Get recent blockhash for transaction building

## Installation

```bash
npm install
npm run build
```

### Environment Configuration

You can customize RPC endpoints using environment variables:

```bash
# Custom RPC endpoints
export SOLANA_MAINNET_RPC="https://your-premium-rpc.com"
export SOLANA_DEVNET_RPC="https://your-devnet-rpc.com"
export SOLANA_TESTNET_RPC="https://your-testnet-rpc.com"
export SOLANA_CUSTOM_RPC="https://helius-rpc.com"

# Then start the server
npm start
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

#### SPL Token CLI Operations
- `create_spl_token` - Create a new SPL token with custom decimals
- `mint_tokens` - Mint tokens to a wallet address
- `burn_tokens` - Burn tokens from a wallet
- `freeze_account` - Freeze a token account
- `thaw_account` - Thaw (unfreeze) a token account
- `set_token_authority` - Set or change token authority (mint, freeze, account owner, close)
- `get_token_supply` - Get total supply and info for a token
- `close_token_account` - Close a token account and reclaim rent
- `approve_delegate` - Approve a delegate to transfer tokens
- `revoke_delegate` - Revoke delegate approval

#### Network Operations
- `switch_network` - Switch Solana network
- `get_network_info` - Get current network information
- `get_recent_blockhash` - Get recent blockhash
- `health_check` - Check server and network connection health

#### Transaction & Analytics
- `get_transaction_history` - Get transaction history for a wallet with pagination
- `get_token_info` - Get token metadata (name, symbol, logo, price from Jupiter)
- `get_all_token_balances` - Get all SPL token balances at once (batch operation)

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

## Deployment

### Smithery Deployment

The server is ready for deployment to Smithery:

```bash
# Build for production
smithery build src/index.ts

# Run locally for testing
smithery dev src/index.ts

# The server will be available at the provided URL
```

### Manual Deployment

1. Clone the repository
2. Install dependencies: `npm install`
3. Build the project: `npm run build`
4. Run the server: `npm start`

## Testing

```bash
# Run basic functionality tests
node test-simple.js

# Run comprehensive tests
node test-comprehensive.js

# Run deployment readiness test
node test-deployment.js
```

## SPL Token CLI Usage Examples

### Create a new SPL token
```javascript
{
  "walletName": "my-wallet",
  "decimals": 9,
  "freezeAuthority": true
}
```

### Mint tokens
```javascript
{
  "walletName": "my-wallet",
  "tokenMint": "TokenMintAddress123...",
  "destinationAddress": "RecipientAddress456...",
  "amount": 1000
}
```

### Burn tokens
```javascript
{
  "walletName": "my-wallet",
  "tokenMint": "TokenMintAddress123...",
  "amount": 100
}
```

### Freeze/Thaw accounts
```javascript
{
  "walletName": "my-wallet",
  "tokenMint": "TokenMintAddress123...",
  "accountAddress": "AccountToFreeze789..."
}
```

### Set token authority
```javascript
{
  "walletName": "my-wallet",
  "tokenMint": "TokenMintAddress123...",
  "authorityType": "MintTokens",
  "newAuthority": "NewAuthorityAddress..."
}
```

### Get token supply
```javascript
{
  "tokenMint": "TokenMintAddress123..."
}
```

## Features Implemented

✅ **Wallet Management**
- Create new Solana wallets
- Import existing wallets from private keys
- List all managed wallets
- Get wallet balances (SOL and SPL tokens)

✅ **Transaction Operations**
- Transfer SOL between wallets
- Transfer SPL tokens
- Request SOL airdrops (devnet/testnet only)
- Get transaction details by signature

✅ **Account Management**
- Get detailed account information
- Create associated token accounts
- List all token accounts for a wallet
- Get token balances

✅ **SPL Token CLI Operations**
- Create new SPL tokens with custom parameters
- Mint and burn tokens
- Freeze and thaw token accounts
- Manage token authorities (mint, freeze, account owner, close)
- Get token supply and metadata
- Close token accounts and reclaim rent
- Delegate management for token operations

✅ **Network Operations**
- Switch between Solana networks (mainnet, devnet, testnet, localhost)
- Get network information and status
- Get recent blockhash for transaction building

✅ **Performance Optimizations**
- Lazy connection initialization (no startup timeouts)
- Network call timeouts (10s default)
- Comprehensive error handling
- Production-ready deployment

## License

MIT