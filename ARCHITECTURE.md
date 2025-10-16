# Architecture & Technical Design

## Current Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Client (Claude)                   │
└────────────────────────┬────────────────────────────────┘
                         │ JSON-RPC over stdio
                         ↓
┌─────────────────────────────────────────────────────────┐
│              Solana MCP Server (Node.js)                 │
│  ┌────────────────────────────────────────────────────┐ │
│  │         MCP Protocol Handler                        │ │
│  │  - Initialize                                       │ │
│  │  - List Tools                                       │ │
│  │  - Call Tool                                        │ │
│  └───────────────────┬────────────────────────────────┘ │
│                      │                                   │
│  ┌───────────────────┴────────────────────────────────┐ │
│  │           Tool Handlers Layer                       │ │
│  │  - Wallet Management  - Token Operations            │ │
│  │  - Transaction Ops    - Network Management          │ │
│  │  - SPL Token CLI      - Account Operations          │ │
│  └───────────────────┬────────────────────────────────┘ │
│                      │                                   │
│  ┌───────────────────┴────────────────────────────────┐ │
│  │           Solana SDK Layer                          │ │
│  │  - @solana/web3.js    - @solana/spl-token          │ │
│  │  - Connection pooling - Transaction builder         │ │
│  └───────────────────┬────────────────────────────────┘ │
│                      │                                   │
│  ┌───────────────────┴────────────────────────────────┐ │
│  │           State Management                          │ │
│  │  - In-memory wallet storage (Map)                   │ │
│  │  - Network connection state                         │ │
│  │  - Current network setting                          │ │
│  └─────────────────────────────────────────────────────┘ │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS/WSS
                         ↓
┌─────────────────────────────────────────────────────────┐
│              Solana Blockchain Network                   │
│  - RPC Nodes (devnet/testnet/mainnet)                   │
│  - Programs (Token, System, etc.)                       │
└─────────────────────────────────────────────────────────┘
```

### Current File Structure

```
solana-mcp-server/
├── src/
│   └── index.ts              # Main server implementation (1400+ lines)
├── test-simple.js            # Basic integration tests
├── test-comprehensive.js     # Full feature tests
├── test-deployment.js        # Deployment readiness tests
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
├── smithery.yaml             # Smithery deployment config
├── Dockerfile                # Container configuration
└── docs/
    └── README.md             # Documentation
```

### Current Components

#### 1. MCP Protocol Layer
```typescript
// Handles MCP-specific operations
- InitializeRequestSchema → Server capabilities
- ListToolsRequestSchema → Available tools
- CallToolRequestSchema → Tool execution
```

#### 2. Tool Handlers (25 tools currently)
**Wallet Management:**
- create_wallet, import_wallet, list_wallets
- get_balance, get_token_balance

**Transaction Operations:**
- transfer_sol, transfer_tokens
- airdrop_sol

**SPL Token CLI:**
- create_spl_token, mint_tokens, burn_tokens
- freeze_account, thaw_account
- set_token_authority, get_token_supply
- close_token_account, approve_delegate, revoke_delegate

**Account Management:**
- get_account_info, get_transaction
- create_token_account, get_token_accounts

**Network Operations:**
- switch_network, get_network_info
- get_recent_blockhash

#### 3. State Management
```typescript
// In-memory storage
const wallets = Map<string, { keypair: Keypair; name: string }>()
let connection: Connection
let currentNetwork: string = "devnet"
let connectionInitialized: boolean = false
```

## Architectural Strengths ✅

1. **Simple & Maintainable**
   - Single file makes it easy to understand
   - Clear separation of concerns
   - No over-engineering

2. **Production Features**
   - Connection pooling
   - Lazy initialization
   - Timeout protection
   - Error handling

3. **Type Safety**
   - Full TypeScript
   - Zod validation
   - Solana SDK types

4. **Extensible**
   - Easy to add new tools
   - Clear pattern to follow
   - Modular handlers

## Architectural Weaknesses ⚠️

1. **Monolithic Structure**
   - 1400+ lines in single file
   - Hard to navigate as features grow
   - Testing individual components difficult

2. **In-Memory State**
   - Wallets lost on restart
   - No persistence layer
   - Scaling issues

3. **No Service Layer**
   - Business logic mixed with handlers
   - Difficult to reuse code
   - Testing requires full setup

4. **Limited Error Handling**
   - Generic error messages
   - No error categorization
   - No retry strategies

5. **No Caching**
   - Repeated RPC calls
   - Unnecessary network traffic
   - Slower response times

## Recommended Architecture

### Modular Structure

```
src/
├── index.ts                    # Server entry point
├── server.ts                   # MCP server setup
├── config/
│   ├── networks.ts            # Network configurations
│   └── constants.ts           # Constants and defaults
├── core/
│   ├── connection.ts          # Connection management
│   ├── wallet-manager.ts      # Wallet persistence
│   └── error-handler.ts       # Error categorization
├── services/
│   ├── wallet-service.ts      # Wallet operations
│   ├── token-service.ts       # Token operations
│   ├── transaction-service.ts # Transaction building
│   ├── nft-service.ts         # NFT operations
│   ├── defi-service.ts        # DeFi integrations
│   └── staking-service.ts     # Staking operations
├── tools/
│   ├── wallet-tools.ts        # Wallet MCP tools
│   ├── token-tools.ts         # Token MCP tools
│   ├── nft-tools.ts           # NFT MCP tools
│   ├── defi-tools.ts          # DeFi MCP tools
│   └── index.ts               # Tool registry
├── utils/
│   ├── validation.ts          # Input validation
│   ├── formatting.ts          # Output formatting
│   ├── cache.ts               # Caching layer
│   └── logger.ts              # Logging utility
├── types/
│   ├── wallet.ts              # Wallet types
│   ├── token.ts               # Token types
│   └── transaction.ts         # Transaction types
└── storage/
    ├── wallet-storage.ts      # Encrypted wallet storage
    └── cache-storage.ts       # Cache implementation
```

### Service Layer Pattern

```typescript
// services/wallet-service.ts
export class WalletService {
  constructor(
    private storage: WalletStorage,
    private connection: Connection
  ) {}

  async createWallet(name: string): Promise<Wallet> {
    // Validate
    // Generate keypair
    // Store encrypted
    // Return wallet info
  }

  async getBalance(address: PublicKey): Promise<Balance> {
    // Check cache
    // Query blockchain
    // Update cache
    // Return balance
  }
}

// tools/wallet-tools.ts
export function createWalletTools(walletService: WalletService): Tool[] {
  return [
    {
      name: "create_wallet",
      handler: async (args) => walletService.createWallet(args.name)
    }
  ];
}
```

### Dependency Injection

```typescript
// index.ts
import { createServer } from './server';
import { WalletService } from './services/wallet-service';
import { TokenService } from './services/token-service';
import { WalletStorage } from './storage/wallet-storage';
import { CacheStorage } from './storage/cache-storage';

// Initialize dependencies
const walletStorage = new WalletStorage('./wallets');
const cacheStorage = new CacheStorage();
const connection = new Connection(rpcUrl);

// Create services
const walletService = new WalletService(walletStorage, connection);
const tokenService = new TokenService(connection, cacheStorage);

// Create server with services
const server = createServer({
  walletService,
  tokenService,
  // ... other services
});

server.start();
```

## Infrastructure Improvements

### 1. Wallet Persistence

```typescript
// storage/wallet-storage.ts
import crypto from 'crypto';
import fs from 'fs/promises';

export class WalletStorage {
  constructor(private storePath: string) {}

  async save(name: string, keypair: Keypair, password: string) {
    const encrypted = this.encrypt(keypair.secretKey, password);
    await fs.writeFile(
      `${this.storePath}/${name}.json`,
      JSON.stringify({ name, encrypted })
    );
  }

  async load(name: string, password: string): Promise<Keypair> {
    const data = await fs.readFile(`${this.storePath}/${name}.json`);
    const { encrypted } = JSON.parse(data.toString());
    const secretKey = this.decrypt(encrypted, password);
    return Keypair.fromSecretKey(secretKey);
  }

  private encrypt(data: Uint8Array, password: string): string {
    // AES-256-GCM encryption
  }

  private decrypt(encrypted: string, password: string): Uint8Array {
    // AES-256-GCM decryption
  }
}
```

### 2. Caching Layer

```typescript
// utils/cache.ts
export class Cache {
  private store = new Map<string, { data: any; expiry: number }>();

  async get<T>(key: string): Promise<T | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
      this.store.delete(key);
      return null;
    }
    return item.data as T;
  }

  async set(key: string, data: any, ttlMs: number = 60000) {
    this.store.set(key, {
      data,
      expiry: Date.now() + ttlMs
    });
  }

  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs?: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached) return cached;

    const data = await fetcher();
    await this.set(key, data, ttlMs);
    return data;
  }
}

// Usage
const balance = await cache.getOrFetch(
  `balance:${address}`,
  () => connection.getBalance(address),
  30000 // 30 second TTL
);
```

### 3. Connection Pool

```typescript
// core/connection.ts
export class ConnectionPool {
  private pools = new Map<string, Connection[]>();
  private current = new Map<string, number>();

  async getConnection(network: string): Promise<Connection> {
    if (!this.pools.has(network)) {
      this.pools.set(network, [
        new Connection(getRpcUrl(network, 0)),
        new Connection(getRpcUrl(network, 1)),
        new Connection(getRpcUrl(network, 2))
      ]);
      this.current.set(network, 0);
    }

    const pool = this.pools.get(network)!;
    const index = this.current.get(network)!;
    const connection = pool[index];

    // Round-robin
    this.current.set(network, (index + 1) % pool.length);

    return connection;
  }

  async healthCheck(network: string): Promise<boolean> {
    try {
      const conn = await this.getConnection(network);
      await conn.getSlot();
      return true;
    } catch {
      return false;
    }
  }
}
```

### 4. Error Handling System

```typescript
// core/error-handler.ts
export enum ErrorCode {
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  NETWORK_ERROR = 'NETWORK_ERROR',
  ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  UNKNOWN = 'UNKNOWN'
}

export class SolanaError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public suggestion?: string,
    public originalError?: Error
  ) {
    super(message);
  }
}

export function handleError(error: any): SolanaError {
  // Pattern matching on error messages
  if (error.message?.includes('insufficient funds')) {
    return new SolanaError(
      'Insufficient funds for transaction',
      ErrorCode.INSUFFICIENT_FUNDS,
      'Request an airdrop or add SOL to wallet'
    );
  }
  // ... more patterns
}

// Retry strategy
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
  throw new Error('Max retries exceeded');
}
```

## Performance Optimizations

### 1. Batch RPC Calls

```typescript
// services/token-service.ts
async getAllTokenBalances(owner: PublicKey): Promise<TokenBalance[]> {
  // Single RPC call instead of multiple
  const accounts = await connection.getParsedTokenAccountsByOwner(
    owner,
    { programId: TOKEN_PROGRAM_ID }
  );

  return accounts.value.map(account => ({
    mint: account.account.data.parsed.info.mint,
    balance: account.account.data.parsed.info.tokenAmount.uiAmount
  }));
}
```

### 2. Parallel Execution

```typescript
// services/transaction-service.ts
async getMultipleTransactions(signatures: string[]) {
  // Fetch all transactions in parallel
  return await Promise.all(
    signatures.map(sig => connection.getTransaction(sig))
  );
}
```

### 3. Lazy Loading

```typescript
// Don't load all wallets upfront
async function loadWallet(name: string): Promise<Wallet> {
  // Only load when needed
  return await walletStorage.load(name);
}
```

## Scalability Considerations

### Horizontal Scaling

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  MCP Server │     │  MCP Server │     │  MCP Server │
│  Instance 1 │     │  Instance 2 │     │  Instance 3 │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┴───────────────────┘
                           │
                    ┌──────┴──────┐
                    │   Redis     │
                    │   Cache     │
                    └──────┬──────┘
                           │
                    ┌──────┴──────┐
                    │  Postgres   │
                    │  Wallet DB  │
                    └─────────────┘
```

### Rate Limiting

```typescript
import Bottleneck from 'bottleneck';

const limiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 200 // 5 requests per second max
});

const rateLimitedGetBalance = limiter.wrap(
  (address: PublicKey) => connection.getBalance(address)
);
```

## Security Best Practices

1. **Encrypted Storage**
   - AES-256-GCM for wallet keys
   - Secure password hashing (Argon2)
   - Key derivation from password

2. **Input Validation**
   - Zod schemas for all inputs
   - Address validation
   - Amount bounds checking

3. **Transaction Signing**
   - Never expose private keys
   - Simulation before sending
   - Confirmation prompts

4. **Environment Isolation**
   - Separate keys per environment
   - Network validation
   - RPC endpoint verification

## Migration Path

### Phase 1: Refactor (Week 1)
- Split index.ts into modules
- Extract services
- Add wallet persistence

### Phase 2: Enhancement (Week 2)
- Add caching layer
- Improve error handling
- Add logging

### Phase 3: Features (Weeks 3-4)
- Implement new services (NFT, DeFi)
- Add comprehensive tests
- Performance optimization

### Phase 4: Scale (Weeks 5-6)
- Connection pooling
- Rate limiting
- Monitoring

## Conclusion

**Current state**: Functional but monolithic
**Target state**: Modular, scalable, production-ready
**Effort required**: 4-6 weeks of focused development
**Payoff**: 10x easier to maintain and extend

**Next steps**:
1. Start with quick wins (QUICK_IMPROVEMENTS.md)
2. Gradually refactor to service layer
3. Add persistence and caching
4. Implement new features in new structure
