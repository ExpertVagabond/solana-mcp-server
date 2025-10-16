# Quick Improvements - Immediate Implementation Guide

These are high-impact, low-effort improvements that can be implemented right away.

## 1. Custom RPC Endpoints (5 min)

**Problem**: Hardcoded RPC URLs, no custom endpoints
**Solution**: Environment variable support

```typescript
// Add to src/index.ts
const NETWORKS = {
  mainnet: process.env.SOLANA_MAINNET_RPC || "https://api.mainnet-beta.solana.com",
  devnet: process.env.SOLANA_DEVNET_RPC || "https://api.devnet.solana.com",
  testnet: process.env.SOLANA_TESTNET_RPC || "https://api.testnet.solana.com",
  localhost: process.env.SOLANA_LOCALHOST_RPC || "http://127.0.0.1:8899",
  custom: process.env.SOLANA_CUSTOM_RPC || ""
};
```

**Usage**:
```bash
export SOLANA_DEVNET_RPC="https://your-premium-rpc.com"
export SOLANA_CUSTOM_RPC="https://helius-rpc.com"
```

## 2. Wallet Export/Import (15 min)

**Problem**: No way to save wallets between sessions
**Solution**: Add export to JSON file

```typescript
// Add new tools
{
  name: "export_wallet",
  description: "Export wallet to encrypted JSON file",
  inputSchema: {
    type: "object",
    properties: {
      walletName: { type: "string" },
      password: { type: "string" },
      filepath: { type: "string", description: "Path to save wallet file" }
    },
    required: ["walletName", "password", "filepath"]
  }
},
{
  name: "import_wallet_file",
  description: "Import wallet from encrypted JSON file",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      password: { type: "string" },
      filepath: { type: "string" }
    },
    required: ["name", "password", "filepath"]
  }
}
```

## 3. Transaction History (20 min)

**Problem**: Can't see past transactions
**Solution**: Add transaction history tool

```typescript
{
  name: "get_transaction_history",
  description: "Get transaction history for a wallet",
  inputSchema: {
    type: "object",
    properties: {
      walletName: { type: "string" },
      limit: { type: "number", default: 10, description: "Number of transactions to fetch" },
      before: { type: "string", description: "Transaction signature to paginate before" }
    },
    required: ["walletName"]
  }
}

async function handleGetTransactionHistory(args: any) {
  const { walletName, limit = 10, before } = args;
  const wallet = wallets.get(walletName);
  if (!wallet) throw new Error(`Wallet '${walletName}' not found`);

  ensureConnection();
  const signatures = await connection.getSignaturesForAddress(
    wallet.keypair.publicKey,
    { limit, before }
  );

  const transactions = await Promise.all(
    signatures.map(async (sig) => {
      const tx = await connection.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0
      });
      return {
        signature: sig.signature,
        slot: sig.slot,
        timestamp: sig.blockTime,
        status: sig.err ? "failed" : "success",
        fee: tx?.meta?.fee,
        explorerUrl: `https://explorer.solana.com/tx/${sig.signature}?cluster=${currentNetwork}`
      };
    })
  );

  return { transactions, count: transactions.length };
}
```

## 4. Token Metadata (15 min)

**Problem**: No token information beyond balances
**Solution**: Fetch token metadata from Jupiter

```typescript
{
  name: "get_token_info",
  description: "Get token metadata (name, symbol, logo, price)",
  inputSchema: {
    type: "object",
    properties: {
      tokenMint: { type: "string", description: "Token mint address" }
    },
    required: ["tokenMint"]
  }
}

async function handleGetTokenInfo(args: any) {
  const { tokenMint } = args;

  // Fetch from Jupiter token list
  const response = await fetch('https://token.jup.ag/strict');
  const tokens = await response.json();
  const tokenInfo = tokens.find((t: any) => t.address === tokenMint);

  if (!tokenInfo) {
    return { tokenMint, found: false };
  }

  // Get price from Jupiter
  const priceResponse = await fetch(`https://price.jup.ag/v6/price?ids=${tokenMint}`);
  const priceData = await priceResponse.json();

  return {
    address: tokenInfo.address,
    name: tokenInfo.name,
    symbol: tokenInfo.symbol,
    decimals: tokenInfo.decimals,
    logoURI: tokenInfo.logoURI,
    price: priceData.data?.[tokenMint]?.price || null,
    found: true
  };
}
```

## 5. Better Error Messages (10 min)

**Problem**: Generic error messages
**Solution**: Categorize and enhance errors

```typescript
class SolanaError extends Error {
  constructor(
    message: string,
    public code: string,
    public suggestion?: string
  ) {
    super(message);
    this.name = 'SolanaError';
  }
}

function enhanceError(error: any): SolanaError {
  // Insufficient funds
  if (error.message?.includes('insufficient funds')) {
    return new SolanaError(
      'Insufficient funds for transaction',
      'INSUFFICIENT_FUNDS',
      'Request an airdrop using airdrop_sol or add SOL to your wallet'
    );
  }

  // Invalid address
  if (error.message?.includes('Invalid public key')) {
    return new SolanaError(
      'Invalid Solana address format',
      'INVALID_ADDRESS',
      'Ensure the address is a valid base58 Solana public key'
    );
  }

  // Network timeout
  if (error.message?.includes('timed out')) {
    return new SolanaError(
      'Network request timed out',
      'NETWORK_TIMEOUT',
      'Try again or switch to a different RPC endpoint'
    );
  }

  // Token account not found
  if (error.message?.includes('could not find account')) {
    return new SolanaError(
      'Token account does not exist',
      'ACCOUNT_NOT_FOUND',
      'Create the token account first using create_token_account'
    );
  }

  return new SolanaError(error.message, 'UNKNOWN_ERROR');
}

// Update error handling in CallToolRequestSchema handler
} catch (error) {
  const enhancedError = enhanceError(error);
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        error: enhancedError.message,
        code: enhancedError.code,
        suggestion: enhancedError.suggestion
      }, null, 2)
    }],
    isError: true
  };
}
```

## 6. Health Check Tool (5 min)

**Problem**: No way to check server status
**Solution**: Add health check tool

```typescript
{
  name: "health_check",
  description: "Check server and network connection health",
  inputSchema: {
    type: "object",
    properties: {}
  }
}

async function handleHealthCheck() {
  const checks = {
    server: "healthy",
    network: currentNetwork,
    rpcUrl: NETWORKS[currentNetwork as keyof typeof NETWORKS],
    connection: "unknown",
    walletsLoaded: wallets.size,
    timestamp: new Date().toISOString()
  };

  try {
    ensureConnection();
    const version = await withTimeout(connection.getVersion(), 5000);
    checks.connection = "healthy";
    return {
      status: "healthy",
      checks,
      solanaVersion: version["solana-core"]
    };
  } catch (error) {
    checks.connection = "unhealthy";
    return {
      status: "degraded",
      checks,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
```

## 7. Token Search (20 min)

**Problem**: Can't discover tokens by name
**Solution**: Search Jupiter token list

```typescript
{
  name: "search_tokens",
  description: "Search for tokens by name or symbol",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search term (name or symbol)" },
      limit: { type: "number", default: 10, description: "Max results to return" }
    },
    required: ["query"]
  }
}

async function handleSearchTokens(args: any) {
  const { query, limit = 10 } = args;

  const response = await fetch('https://token.jup.ag/strict');
  const tokens = await response.json();

  const searchTerm = query.toLowerCase();
  const results = tokens
    .filter((token: any) =>
      token.name.toLowerCase().includes(searchTerm) ||
      token.symbol.toLowerCase().includes(searchTerm)
    )
    .slice(0, limit)
    .map((token: any) => ({
      address: token.address,
      name: token.name,
      symbol: token.symbol,
      decimals: token.decimals,
      logoURI: token.logoURI
    }));

  return {
    query,
    results,
    count: results.length
  };
}
```

## 8. Transaction Simulation (15 min)

**Problem**: Transactions fail without knowing why
**Solution**: Simulate before sending

```typescript
{
  name: "simulate_transfer",
  description: "Simulate a SOL transfer without sending",
  inputSchema: {
    type: "object",
    properties: {
      fromWallet: { type: "string" },
      toAddress: { type: "string" },
      amount: { type: "number" }
    },
    required: ["fromWallet", "toAddress", "amount"]
  }
}

async function handleSimulateTransfer(args: any) {
  const { fromWallet, toAddress, amount } = args;

  const wallet = wallets.get(fromWallet);
  if (!wallet) throw new Error(`Wallet '${fromWallet}' not found`);

  ensureConnection();
  const toPubkey = new PublicKey(toAddress);
  const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.keypair.publicKey,
      toPubkey: toPubkey,
      lamports: lamports,
    })
  );

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.keypair.publicKey;

  // Simulate the transaction
  const simulation = await connection.simulateTransaction(transaction);

  return {
    success: !simulation.value.err,
    error: simulation.value.err,
    logs: simulation.value.logs,
    unitsConsumed: simulation.value.unitsConsumed,
    estimatedFee: simulation.value.unitsConsumed ?
      Math.ceil(simulation.value.unitsConsumed * 0.000001 * LAMPORTS_PER_SOL) : null
  };
}
```

## 9. Batch Token Balance (10 min)

**Problem**: Checking multiple token balances is slow
**Solution**: Get all token balances at once

```typescript
{
  name: "get_all_token_balances",
  description: "Get all SPL token balances for a wallet at once",
  inputSchema: {
    type: "object",
    properties: {
      walletName: { type: "string" },
      includeZeroBalances: { type: "boolean", default: false }
    },
    required: ["walletName"]
  }
}

async function handleGetAllTokenBalances(args: any) {
  const { walletName, includeZeroBalances = false } = args;

  const wallet = wallets.get(walletName);
  if (!wallet) throw new Error(`Wallet '${walletName}' not found`);

  ensureConnection();
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
    wallet.keypair.publicKey,
    { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
  );

  const balances = tokenAccounts.value
    .map(account => {
      const data = account.account.data.parsed.info;
      return {
        mint: data.mint,
        balance: data.tokenAmount.uiAmount,
        decimals: data.tokenAmount.decimals,
        rawBalance: data.tokenAmount.amount
      };
    })
    .filter(token => includeZeroBalances || token.balance > 0);

  return {
    wallet: walletName,
    address: wallet.keypair.publicKey.toString(),
    tokens: balances,
    count: balances.length
  };
}
```

## 10. Logging System (10 min)

**Problem**: No structured logging
**Solution**: Add simple logger

```typescript
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

const currentLogLevel = process.env.LOG_LEVEL === 'DEBUG' ? LogLevel.DEBUG : LogLevel.INFO;

function log(level: LogLevel, message: string, data?: any) {
  if (level < currentLogLevel) return;

  const timestamp = new Date().toISOString();
  const levelStr = LogLevel[level];
  const logEntry = {
    timestamp,
    level: levelStr,
    message,
    ...(data && { data })
  };

  // Log to stderr so it doesn't interfere with MCP protocol on stdout
  console.error(JSON.stringify(logEntry));
}

// Usage
log(LogLevel.INFO, 'Wallet created', { name: walletName, address });
log(LogLevel.ERROR, 'Transaction failed', { error: error.message, signature });
log(LogLevel.DEBUG, 'RPC call', { method: 'getBalance', params });
```

## Implementation Order

1. **RPC Configuration** (5 min) - Foundation for everything
2. **Error Handling** (10 min) - Better DX immediately
3. **Health Check** (5 min) - Essential monitoring
4. **Transaction History** (20 min) - High user value
5. **Token Metadata** (15 min) - Completes token features
6. **Wallet Export** (15 min) - Critical for persistence
7. **All Token Balances** (10 min) - Performance improvement
8. **Transaction Simulation** (15 min) - Prevents errors
9. **Token Search** (20 min) - Discovery feature
10. **Logging** (10 min) - Debugging and monitoring

**Total Time**: ~2-3 hours of focused development

## Testing Each Feature

Add tests to `test-simple.js`:

```javascript
// Test transaction history
{
  jsonrpc: "2.0",
  id: 10,
  method: "tools/call",
  params: {
    name: "get_transaction_history",
    arguments: { walletName: "test-wallet", limit: 5 }
  }
},
// Test token search
{
  jsonrpc: "2.0",
  id: 11,
  method: "tools/call",
  params: {
    name: "search_tokens",
    arguments: { query: "USDC", limit: 5 }
  }
},
// Test health check
{
  jsonrpc: "2.0",
  id: 12,
  method: "tools/call",
  params: {
    name: "health_check",
    arguments: {}
  }
}
```

## Next Steps After Quick Wins

Once these are implemented, tackle:
1. NFT support (Metaplex)
2. Jupiter swap integration
3. Native staking
4. Comprehensive test suite

See `IMPROVEMENT_ROADMAP.md` for complete feature list.
