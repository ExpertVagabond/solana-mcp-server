#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  createMint,
  mintTo,
  burn,
  freezeAccount,
  thawAccount,
  setAuthority,
  AuthorityType,
  getMint,
  closeAccount,
  approve,
  revoke
} from "@solana/spl-token";
import bs58 from "bs58";
import { z } from "zod";

// --- Input validation helpers ---

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
const WALLET_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_SOL_TRANSFER = 1000; // safety cap
const MAX_TOKEN_AMOUNT = 1e15;
const VALID_NETWORKS = new Set(["mainnet", "devnet", "testnet", "localhost"]);
const VALID_AUTHORITY_TYPES = new Set(["MintTokens", "FreezeAccount", "AccountOwner", "CloseAccount"]);

// --- Zod schemas for all handler inputs ---
// These provide runtime type-checking at the boundary before any field-level validators run

const CreateWalletSchema = z.object({ name: z.string() }).strict();
const ImportWalletSchema = z.object({ name: z.string(), privateKey: z.string() }).strict();
const WalletNameSchema = z.object({ walletName: z.string() }).strict();
const WalletTokenSchema = z.object({ walletName: z.string(), tokenMint: z.string() }).strict();
const TransferSolSchema = z.object({ fromWallet: z.string(), toAddress: z.string(), amount: z.number() }).strict();
const TransferTokensSchema = z.object({ fromWallet: z.string(), toAddress: z.string(), tokenMint: z.string(), amount: z.number() }).strict();
const AirdropSolSchema = z.object({ walletName: z.string(), amount: z.number().optional() }).strict();
const AddressSchema = z.object({ address: z.string() }).strict();
const SignatureSchema = z.object({ signature: z.string() }).strict();
const SwitchNetworkSchema = z.object({ network: z.string() }).strict();
const CreateSplTokenSchema = z.object({ walletName: z.string(), decimals: z.number().optional(), freezeAuthority: z.boolean().optional() }).strict();
const MintTokensSchema = z.object({ walletName: z.string(), tokenMint: z.string(), destinationAddress: z.string(), amount: z.number() }).strict();
const BurnTokensSchema = z.object({ walletName: z.string(), tokenMint: z.string(), amount: z.number() }).strict();
const FreezeThawSchema = z.object({ walletName: z.string(), tokenMint: z.string(), accountAddress: z.string() }).strict();
const SetAuthoritySchema = z.object({ walletName: z.string(), tokenMint: z.string(), authorityType: z.string(), newAuthority: z.string().optional() }).strict();
const TokenMintSchema = z.object({ tokenMint: z.string() }).strict();
const CloseTokenAccountSchema = z.object({ walletName: z.string(), tokenMint: z.string(), destinationAddress: z.string() }).strict();
const ApproveDelegateSchema = z.object({ walletName: z.string(), tokenMint: z.string(), delegateAddress: z.string(), amount: z.number() }).strict();
const RevokeDelegateSchema = z.object({ walletName: z.string(), tokenMint: z.string() }).strict();

function sanitizeError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  // Strip potential stack traces, internal paths, and private key material from user-facing errors
  const firstLine = msg.split("\n")[0].slice(0, 500);
  // Redact anything that looks like a private key (long base58 strings > 60 chars)
  return firstLine.replace(/[1-9A-HJ-NP-Za-km-z]{60,}/g, "[REDACTED]");
}

function validateAddress(address: string, label = "address"): void {
  if (!address || typeof address !== "string") {
    throw new Error(`${label} is required`);
  }
  if (!SOLANA_ADDRESS_RE.test(address)) {
    throw new Error(`Invalid ${label}: must be a valid base58-encoded Solana address (32-44 chars)`);
  }
  // Verify it can actually construct a PublicKey
  try {
    new PublicKey(address);
  } catch {
    throw new Error(`Invalid ${label}: not a valid Solana public key`);
  }
}

function validateWalletName(name: string): void {
  if (!name || typeof name !== "string") {
    throw new Error("Wallet name is required");
  }
  if (!WALLET_NAME_RE.test(name)) {
    throw new Error("Wallet name must be 1-64 alphanumeric characters, hyphens, or underscores");
  }
}

function validateAmount(amount: number, label = "amount", max = MAX_SOL_TRANSFER): void {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new Error(`${label} must be a finite number`);
  }
  if (amount <= 0) {
    throw new Error(`${label} must be positive`);
  }
  if (amount > max) {
    throw new Error(`${label} exceeds maximum allowed (${max})`);
  }
}

function validateNetwork(network: string): void {
  if (!network || typeof network !== "string") {
    throw new Error("Network is required");
  }
  if (!VALID_NETWORKS.has(network)) {
    throw new Error(`Invalid network: must be one of ${[...VALID_NETWORKS].join(", ")}`);
  }
}

function validateAuthorityType(authorityType: string): void {
  if (!authorityType || typeof authorityType !== "string") {
    throw new Error("Authority type is required");
  }
  if (!VALID_AUTHORITY_TYPES.has(authorityType)) {
    throw new Error(`Invalid authority type: must be one of ${[...VALID_AUTHORITY_TYPES].join(", ")}`);
  }
}

function validateDecimals(decimals: number): void {
  if (typeof decimals !== "number" || !Number.isInteger(decimals)) {
    throw new Error("Decimals must be an integer");
  }
  if (decimals < 0 || decimals > 18) {
    throw new Error("Decimals must be between 0 and 18");
  }
}

function validateSignature(signature: string): void {
  if (!signature || typeof signature !== "string") {
    throw new Error("Transaction signature is required");
  }
  if (signature.length < 32 || signature.length > 128) {
    throw new Error("Invalid transaction signature length");
  }
  if (!BASE58_RE.test(signature)) {
    throw new Error("Invalid transaction signature: must be base58-encoded");
  }
}

function validatePrivateKey(privateKey: string): void {
  if (!privateKey || typeof privateKey !== "string") {
    throw new Error("Private key is required");
  }
  if (privateKey.length < 32 || privateKey.length > 128) {
    throw new Error("Invalid private key length");
  }
  if (!BASE58_RE.test(privateKey)) {
    throw new Error("Invalid private key: must be base58-encoded");
  }
}

// Solana network configurations
const NETWORKS = {
  mainnet: "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  localhost: "http://127.0.0.1:8899"
};

// Wallet storage (in production, use secure storage)
const wallets = new Map<string, { keypair: Keypair; name: string }>();

// Initialize connection
let connection: Connection;
let currentNetwork = "devnet";

function initializeConnection(network: string = "devnet") {
  if (!VALID_NETWORKS.has(network)) {
    throw new Error(`Invalid network '${network}': must be one of ${[...VALID_NETWORKS].join(", ")}`);
  }
  currentNetwork = network;
  const rpcUrl = NETWORKS[network as keyof typeof NETWORKS];
  connection = new Connection(rpcUrl, "confirmed");
}

// Initialize connection lazily to avoid startup timeouts
let connectionInitialized = false;

function ensureConnection() {
  if (!connectionInitialized) {
    initializeConnection();
    connectionInitialized = true;
  }
}

// Add timeout wrapper for network calls
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 10000): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Operation timed out')), timeoutMs);
  });
  
  return Promise.race([promise, timeoutPromise]);
}

// Tool definitions
const tools: Tool[] = [
  {
    name: "create_wallet",
    description: "Create a new Solana wallet",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name for the wallet"
        }
      },
      required: ["name"]
    }
  },
  {
    name: "import_wallet",
    description: "Import an existing wallet from private key or mnemonic",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name for the wallet"
        },
        privateKey: {
          type: "string",
          description: "Private key in base58 format"
        }
      },
      required: ["name", "privateKey"]
    }
  },
  {
    name: "list_wallets",
    description: "List all created/imported wallets",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_balance",
    description: "Get SOL balance for a wallet",
    inputSchema: {
      type: "object",
      properties: {
        walletName: {
          type: "string",
          description: "Name of the wallet"
        }
      },
      required: ["walletName"]
    }
  },
  {
    name: "get_token_balance",
    description: "Get SPL token balance for a wallet",
    inputSchema: {
      type: "object",
      properties: {
        walletName: {
          type: "string",
          description: "Name of the wallet"
        },
        tokenMint: {
          type: "string",
          description: "Token mint address"
        }
      },
      required: ["walletName", "tokenMint"]
    }
  },
  {
    name: "transfer_sol",
    description: "Transfer SOL between wallets",
    inputSchema: {
      type: "object",
      properties: {
        fromWallet: {
          type: "string",
          description: "Name of the sender wallet"
        },
        toAddress: {
          type: "string",
          description: "Recipient address"
        },
        amount: {
          type: "number",
          description: "Amount in SOL"
        }
      },
      required: ["fromWallet", "toAddress", "amount"]
    }
  },
  {
    name: "transfer_tokens",
    description: "Transfer SPL tokens between wallets",
    inputSchema: {
      type: "object",
      properties: {
        fromWallet: {
          type: "string",
          description: "Name of the sender wallet"
        },
        toAddress: {
          type: "string",
          description: "Recipient address"
        },
        tokenMint: {
          type: "string",
          description: "Token mint address"
        },
        amount: {
          type: "number",
          description: "Amount of tokens to transfer"
        }
      },
      required: ["fromWallet", "toAddress", "tokenMint", "amount"]
    }
  },
  {
    name: "airdrop_sol",
    description: "Request SOL airdrop for testing (devnet/testnet only)",
    inputSchema: {
      type: "object",
      properties: {
        walletName: {
          type: "string",
          description: "Name of the wallet"
        },
        amount: {
          type: "number",
          description: "Amount of SOL to airdrop (default: 1)"
        }
      },
      required: ["walletName"]
    }
  },
  {
    name: "get_account_info",
    description: "Get detailed account information",
    inputSchema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Account address"
        }
      },
      required: ["address"]
    }
  },
  {
    name: "get_transaction",
    description: "Get transaction details by signature",
    inputSchema: {
      type: "object",
      properties: {
        signature: {
          type: "string",
          description: "Transaction signature"
        }
      },
      required: ["signature"]
    }
  },
  {
    name: "get_recent_blockhash",
    description: "Get recent blockhash for transaction building",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "switch_network",
    description: "Switch Solana network",
    inputSchema: {
      type: "object",
      properties: {
        network: {
          type: "string",
          enum: ["mainnet", "devnet", "testnet", "localhost"],
          description: "Network to switch to"
        }
      },
      required: ["network"]
    }
  },
  {
    name: "get_network_info",
    description: "Get current network information",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "create_token_account",
    description: "Create associated token account for SPL tokens",
    inputSchema: {
      type: "object",
      properties: {
        walletName: {
          type: "string",
          description: "Name of the wallet"
        },
        tokenMint: {
          type: "string",
          description: "Token mint address"
        }
      },
      required: ["walletName", "tokenMint"]
    }
  },
  {
    name: "get_token_accounts",
    description: "Get all token accounts for a wallet",
    inputSchema: {
      type: "object",
      properties: {
        walletName: {
          type: "string",
          description: "Name of the wallet"
        }
      },
      required: ["walletName"]
    }
  },
  {
    name: "create_spl_token",
    description: "Create a new SPL token with specified decimals",
    inputSchema: {
      type: "object",
      properties: {
        walletName: {
          type: "string",
          description: "Name of the wallet that will be the mint authority"
        },
        decimals: {
          type: "number",
          description: "Number of decimal places for the token (default: 9)"
        },
        freezeAuthority: {
          type: "boolean",
          description: "Whether to enable freeze authority (default: false)"
        }
      },
      required: ["walletName"]
    }
  },
  {
    name: "mint_tokens",
    description: "Mint tokens to a specific account",
    inputSchema: {
      type: "object",
      properties: {
        walletName: {
          type: "string",
          description: "Name of the wallet with mint authority"
        },
        tokenMint: {
          type: "string",
          description: "Token mint address"
        },
        destinationAddress: {
          type: "string",
          description: "Destination wallet address"
        },
        amount: {
          type: "number",
          description: "Amount of tokens to mint (in token units, not raw)"
        }
      },
      required: ["walletName", "tokenMint", "destinationAddress", "amount"]
    }
  },
  {
    name: "burn_tokens",
    description: "Burn tokens from a wallet",
    inputSchema: {
      type: "object",
      properties: {
        walletName: {
          type: "string",
          description: "Name of the wallet to burn tokens from"
        },
        tokenMint: {
          type: "string",
          description: "Token mint address"
        },
        amount: {
          type: "number",
          description: "Amount of tokens to burn (in token units)"
        }
      },
      required: ["walletName", "tokenMint", "amount"]
    }
  },
  {
    name: "freeze_account",
    description: "Freeze a token account to prevent transfers",
    inputSchema: {
      type: "object",
      properties: {
        walletName: {
          type: "string",
          description: "Name of the wallet with freeze authority"
        },
        tokenMint: {
          type: "string",
          description: "Token mint address"
        },
        accountAddress: {
          type: "string",
          description: "Address of the token account to freeze"
        }
      },
      required: ["walletName", "tokenMint", "accountAddress"]
    }
  },
  {
    name: "thaw_account",
    description: "Thaw a frozen token account to allow transfers",
    inputSchema: {
      type: "object",
      properties: {
        walletName: {
          type: "string",
          description: "Name of the wallet with freeze authority"
        },
        tokenMint: {
          type: "string",
          description: "Token mint address"
        },
        accountAddress: {
          type: "string",
          description: "Address of the token account to thaw"
        }
      },
      required: ["walletName", "tokenMint", "accountAddress"]
    }
  },
  {
    name: "set_token_authority",
    description: "Set or change authority for a token mint or account",
    inputSchema: {
      type: "object",
      properties: {
        walletName: {
          type: "string",
          description: "Name of the wallet with current authority"
        },
        tokenMint: {
          type: "string",
          description: "Token mint address"
        },
        authorityType: {
          type: "string",
          enum: ["MintTokens", "FreezeAccount", "AccountOwner", "CloseAccount"],
          description: "Type of authority to set"
        },
        newAuthority: {
          type: "string",
          description: "Address of new authority (or null to revoke authority)"
        }
      },
      required: ["walletName", "tokenMint", "authorityType"]
    }
  },
  {
    name: "get_token_supply",
    description: "Get the total supply of a token",
    inputSchema: {
      type: "object",
      properties: {
        tokenMint: {
          type: "string",
          description: "Token mint address"
        }
      },
      required: ["tokenMint"]
    }
  },
  {
    name: "close_token_account",
    description: "Close a token account and reclaim rent",
    inputSchema: {
      type: "object",
      properties: {
        walletName: {
          type: "string",
          description: "Name of the wallet that owns the account"
        },
        tokenMint: {
          type: "string",
          description: "Token mint address"
        },
        destinationAddress: {
          type: "string",
          description: "Address to send remaining lamports to"
        }
      },
      required: ["walletName", "tokenMint", "destinationAddress"]
    }
  },
  {
    name: "approve_delegate",
    description: "Approve a delegate to transfer tokens on your behalf",
    inputSchema: {
      type: "object",
      properties: {
        walletName: {
          type: "string",
          description: "Name of the wallet that owns the tokens"
        },
        tokenMint: {
          type: "string",
          description: "Token mint address"
        },
        delegateAddress: {
          type: "string",
          description: "Address of the delegate"
        },
        amount: {
          type: "number",
          description: "Maximum amount delegate can transfer"
        }
      },
      required: ["walletName", "tokenMint", "delegateAddress", "amount"]
    }
  },
  {
    name: "revoke_delegate",
    description: "Revoke a delegate's authority to transfer tokens",
    inputSchema: {
      type: "object",
      properties: {
        walletName: {
          type: "string",
          description: "Name of the wallet that owns the tokens"
        },
        tokenMint: {
          type: "string",
          description: "Token mint address"
        }
      },
      required: ["walletName", "tokenMint"]
    }
  }
];

// Tool handlers
async function handleCreateWallet(args: Record<string, unknown>) {
  const parsed = CreateWalletSchema.parse(args);
  const { name } = parsed;
  validateWalletName(name);

  if (wallets.has(name)) {
    throw new Error(`Wallet with name '${name}' already exists`);
  }

  const keypair = Keypair.generate();
  wallets.set(name, { keypair, name });

  return {
    success: true,
    wallet: {
      name,
      address: keypair.publicKey.toString(),
    },
    warning: "Private key is stored in memory for this session only. Use export_wallet if you need to back it up. Never share private keys."
  };
}

async function handleImportWallet(args: Record<string, unknown>) {
  const parsed = ImportWalletSchema.parse(args);
  const { name, privateKey } = parsed;
  validateWalletName(name);
  validatePrivateKey(privateKey);

  if (wallets.has(name)) {
    throw new Error(`Wallet with name '${name}' already exists`);
  }

  try {
    const secretKey = bs58.decode(privateKey);
    if (secretKey.length !== 64) {
      throw new Error("Invalid secret key length");
    }
    const keypair = Keypair.fromSecretKey(secretKey);
    wallets.set(name, { keypair, name });

    return {
      success: true,
      wallet: {
        name,
        address: keypair.publicKey.toString()
      }
    };
  } catch (error) {
    // Never echo back the private key in error messages
    throw new Error("Invalid private key: could not decode or derive keypair");
  }
}

async function handleListWallets() {
  const walletList = Array.from(wallets.values()).map(wallet => ({
    name: wallet.name,
    address: wallet.keypair.publicKey.toString()
  }));

  return {
    wallets: walletList,
    count: walletList.length
  };
}

async function handleGetBalance(args: Record<string, unknown>) {
  const parsed = WalletNameSchema.parse(args);
  const { walletName } = parsed;
  validateWalletName(walletName);

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const balance = await withTimeout(connection.getBalance(wallet.keypair.publicKey));
  const solBalance = balance / LAMPORTS_PER_SOL;

  return {
    wallet: walletName,
    address: wallet.keypair.publicKey.toString(),
    balance: {
      lamports: balance,
      sol: solBalance
    }
  };
}

async function handleGetTokenBalance(args: Record<string, unknown>) {
  const parsed = WalletTokenSchema.parse(args);
  const { walletName, tokenMint } = parsed;
  validateWalletName(walletName);
  validateAddress(tokenMint, "tokenMint");

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);
  const tokenAccount = await getAssociatedTokenAddress(tokenMintPubkey, wallet.keypair.publicKey);

  try {
    const accountInfo = await withTimeout(getAccount(connection, tokenAccount));

    return {
      wallet: walletName,
      tokenMint: tokenMint,
      balance: accountInfo.amount.toString(),
      decimals: accountInfo.mint.toString()
    };
  } catch (error: unknown) {
    // Distinguish "account not found" from network/timeout errors
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("could not find account") || msg.includes("TokenAccountNotFoundError")) {
      return {
        wallet: walletName,
        tokenMint: tokenMint,
        balance: "0",
        note: "Token account does not exist for this wallet"
      };
    }
    throw new Error(`Failed to retrieve token balance: ${sanitizeError(error)}`);
  }
}

async function handleTransferSol(args: Record<string, unknown>) {
  const parsed = TransferSolSchema.parse(args);
  const { fromWallet, toAddress, amount } = parsed;
  validateWalletName(fromWallet);
  validateAddress(toAddress, "toAddress");
  validateAmount(amount, "SOL amount", MAX_SOL_TRANSFER);

  const wallet = wallets.get(fromWallet);
  if (!wallet) {
    throw new Error(`Wallet '${fromWallet}' not found`);
  }

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

  const { blockhash } = await withTimeout(connection.getLatestBlockhash());
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.keypair.publicKey;

  transaction.sign(wallet.keypair);

  const signature = await withTimeout(connection.sendTransaction(transaction, [wallet.keypair]), 30000);

  return {
    success: true,
    signature,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleTransferTokens(args: Record<string, unknown>) {
  const parsed = TransferTokensSchema.parse(args);
  const { fromWallet, toAddress, tokenMint, amount } = parsed;
  validateWalletName(fromWallet);
  validateAddress(toAddress, "toAddress");
  validateAddress(tokenMint, "tokenMint");
  validateAmount(amount, "token amount", MAX_TOKEN_AMOUNT);

  const wallet = wallets.get(fromWallet);
  if (!wallet) {
    throw new Error(`Wallet '${fromWallet}' not found`);
  }

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);
  const toPubkey = new PublicKey(toAddress);

  const fromTokenAccount = await getAssociatedTokenAddress(tokenMintPubkey, wallet.keypair.publicKey);
  const toTokenAccount = await getAssociatedTokenAddress(tokenMintPubkey, toPubkey);

  const transaction = new Transaction();

  // Check if recipient has token account, create if not
  let recipientAccountExists = false;
  try {
    await withTimeout(getAccount(connection, toTokenAccount));
    recipientAccountExists = true;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    // Only create account if it genuinely doesn't exist; re-throw network errors
    if (msg.includes("could not find account") || msg.includes("TokenAccountNotFoundError")) {
      recipientAccountExists = false;
    } else if (msg.includes("timed out")) {
      throw new Error("Network timeout checking recipient token account");
    } else {
      recipientAccountExists = false; // Assume doesn't exist for other SPL errors
    }
  }

  if (!recipientAccountExists) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        wallet.keypair.publicKey,
        toTokenAccount,
        toPubkey,
        tokenMintPubkey
      )
    );
  }

  transaction.add(
    createTransferInstruction(
      fromTokenAccount,
      toTokenAccount,
      wallet.keypair.publicKey,
      BigInt(Math.floor(amount))
    )
  );

  const { blockhash } = await withTimeout(connection.getLatestBlockhash());
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.keypair.publicKey;

  transaction.sign(wallet.keypair);

  const signature = await withTimeout(connection.sendTransaction(transaction, [wallet.keypair]), 30000);

  return {
    success: true,
    signature,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleAirdropSol(args: Record<string, unknown>) {
  const parsed = AirdropSolSchema.parse(args);
  const { walletName, amount: rawAmount } = parsed;
  const amount = rawAmount ?? 1;
  validateWalletName(walletName);
  validateAmount(amount, "airdrop amount", 5); // devnet cap

  if (currentNetwork === "mainnet") {
    throw new Error("Airdrop is not available on mainnet");
  }

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
  const signature = await withTimeout(connection.requestAirdrop(wallet.keypair.publicKey, lamports), 30000);

  return {
    success: true,
    signature,
    amount: amount,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleGetAccountInfo(args: Record<string, unknown>) {
  const parsed = AddressSchema.parse(args);
  const { address } = parsed;
  validateAddress(address);

  ensureConnection();
  const pubkey = new PublicKey(address);
  const accountInfo = await withTimeout(connection.getAccountInfo(pubkey));

  if (!accountInfo) {
    return {
      address,
      exists: false
    };
  }

  return {
    address,
    exists: true,
    lamports: accountInfo.lamports,
    owner: accountInfo.owner.toString(),
    executable: accountInfo.executable,
    rentEpoch: accountInfo.rentEpoch,
    dataLength: accountInfo.data.length
  };
}

async function handleGetTransaction(args: Record<string, unknown>) {
  const parsed = SignatureSchema.parse(args);
  const { signature } = parsed;
  validateSignature(signature);

  ensureConnection();
  const transaction = await withTimeout(connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0
  }));

  if (!transaction) {
    throw new Error("Transaction not found");
  }

  return {
    signature,
    slot: transaction.slot,
    blockTime: transaction.blockTime,
    fee: transaction.meta?.fee,
    success: transaction.meta?.err ? false : true,
    error: transaction.meta?.err
  };
}

async function handleGetRecentBlockhash() {
  ensureConnection();
  const { blockhash } = await withTimeout(connection.getLatestBlockhash());
  
  return {
    blockhash,
    network: currentNetwork
  };
}

async function handleSwitchNetwork(args: Record<string, unknown>) {
  const parsed = SwitchNetworkSchema.parse(args);
  const { network } = parsed;
  validateNetwork(network);

  initializeConnection(network);

  return {
    success: true,
    network: currentNetwork,
    rpcUrl: NETWORKS[network as keyof typeof NETWORKS]
  };
}

async function handleGetNetworkInfo() {
  ensureConnection();
  const version = await withTimeout(connection.getVersion());
  const epochInfo = await withTimeout(connection.getEpochInfo());
  
  return {
    network: currentNetwork,
    rpcUrl: NETWORKS[currentNetwork as keyof typeof NETWORKS],
    version: version["solana-core"],
    epoch: epochInfo.epoch,
    slotIndex: epochInfo.slotIndex,
    slotsInEpoch: epochInfo.slotsInEpoch
  };
}

async function handleCreateTokenAccount(args: Record<string, unknown>) {
  const parsed = WalletTokenSchema.parse(args);
  const { walletName, tokenMint } = parsed;
  validateWalletName(walletName);
  validateAddress(tokenMint, "tokenMint");

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);
  const tokenAccount = await getAssociatedTokenAddress(tokenMintPubkey, wallet.keypair.publicKey);

  const transaction = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      wallet.keypair.publicKey,
      tokenAccount,
      wallet.keypair.publicKey,
      tokenMintPubkey
    )
  );

  const { blockhash } = await withTimeout(connection.getLatestBlockhash());
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.keypair.publicKey;

  transaction.sign(wallet.keypair);

  const signature = await withTimeout(connection.sendTransaction(transaction, [wallet.keypair]), 30000);

  return {
    success: true,
    tokenAccount: tokenAccount.toString(),
    signature,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleGetTokenAccounts(args: Record<string, unknown>) {
  const parsed = WalletNameSchema.parse(args);
  const { walletName } = parsed;
  validateWalletName(walletName);

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenAccounts = await withTimeout(connection.getParsedTokenAccountsByOwner(wallet.keypair.publicKey, {
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
  }));

  const accounts = tokenAccounts.value.map(account => {
    const parsed = account.account.data;
    return {
      address: account.pubkey.toString(),
      mint: parsed.parsed?.info?.mint || "unknown",
      amount: parsed.parsed?.info?.tokenAmount?.uiAmount ?? 0,
      decimals: parsed.parsed?.info?.tokenAmount?.decimals ?? 0
    };
  });

  return {
    wallet: walletName,
    tokenAccounts: accounts,
    count: accounts.length
  };
}

async function handleCreateSplToken(args: Record<string, unknown>) {
  const parsed = CreateSplTokenSchema.parse(args);
  const { walletName, decimals: rawDecimals, freezeAuthority: rawFreezeAuth } = parsed;
  const decimals = rawDecimals ?? 9;
  const freezeAuthority = rawFreezeAuth ?? false;
  validateWalletName(walletName);
  validateDecimals(decimals);

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();

  const freezeAuthorityPubkey = freezeAuthority ? wallet.keypair.publicKey : null;

  const mint = await withTimeout(createMint(
    connection,
    wallet.keypair,
    wallet.keypair.publicKey,
    freezeAuthorityPubkey,
    decimals
  ), 30000);

  return {
    success: true,
    tokenMint: mint.toString(),
    decimals,
    mintAuthority: wallet.keypair.publicKey.toString(),
    freezeAuthority: freezeAuthorityPubkey ? freezeAuthorityPubkey.toString() : null,
    explorerUrl: `https://explorer.solana.com/address/${mint.toString()}?cluster=${currentNetwork}`
  };
}

async function handleMintTokens(args: Record<string, unknown>) {
  const parsed = MintTokensSchema.parse(args);
  const { walletName, tokenMint, destinationAddress, amount } = parsed;
  validateWalletName(walletName);
  validateAddress(tokenMint, "tokenMint");
  validateAddress(destinationAddress, "destinationAddress");
  validateAmount(amount, "mint amount", MAX_TOKEN_AMOUNT);

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);
  const destinationPubkey = new PublicKey(destinationAddress);

  const mintInfo = await withTimeout(getMint(connection, tokenMintPubkey));
  const rawAmount = BigInt(Math.floor(amount * Math.pow(10, mintInfo.decimals)));

  const destinationTokenAccount = await getAssociatedTokenAddress(
    tokenMintPubkey,
    destinationPubkey
  );

  // Check if destination token account exists, create if not
  let destAccountExists = false;
  try {
    await withTimeout(getAccount(connection, destinationTokenAccount));
    destAccountExists = true;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("could not find account") || msg.includes("TokenAccountNotFoundError")) {
      destAccountExists = false;
    } else if (msg.includes("timed out")) {
      throw new Error("Network timeout checking destination token account");
    } else {
      destAccountExists = false;
    }
  }

  if (!destAccountExists) {
    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.keypair.publicKey,
        destinationTokenAccount,
        destinationPubkey,
        tokenMintPubkey
      )
    );

    const { blockhash } = await withTimeout(connection.getLatestBlockhash());
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.keypair.publicKey;
    transaction.sign(wallet.keypair);

    await withTimeout(connection.sendTransaction(transaction, [wallet.keypair]), 30000);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for account creation
  }

  const signature = await withTimeout(mintTo(
    connection,
    wallet.keypair,
    tokenMintPubkey,
    destinationTokenAccount,
    wallet.keypair,
    rawAmount
  ), 30000);

  return {
    success: true,
    signature,
    amount,
    tokenMint: tokenMint,
    destination: destinationAddress,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleBurnTokens(args: Record<string, unknown>) {
  const parsed = BurnTokensSchema.parse(args);
  const { walletName, tokenMint, amount } = parsed;
  validateWalletName(walletName);
  validateAddress(tokenMint, "tokenMint");
  validateAmount(amount, "burn amount", MAX_TOKEN_AMOUNT);

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);

  const mintInfo = await withTimeout(getMint(connection, tokenMintPubkey));
  const rawAmount = BigInt(Math.floor(amount * Math.pow(10, mintInfo.decimals)));

  const tokenAccount = await getAssociatedTokenAddress(
    tokenMintPubkey,
    wallet.keypair.publicKey
  );

  const signature = await withTimeout(burn(
    connection,
    wallet.keypair,
    tokenAccount,
    tokenMintPubkey,
    wallet.keypair,
    rawAmount
  ), 30000);

  return {
    success: true,
    signature,
    amount,
    tokenMint: tokenMint,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleFreezeAccount(args: Record<string, unknown>) {
  const parsed = FreezeThawSchema.parse(args);
  const { walletName, tokenMint, accountAddress } = parsed;
  validateWalletName(walletName);
  validateAddress(tokenMint, "tokenMint");
  validateAddress(accountAddress, "accountAddress");

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);
  const accountPubkey = new PublicKey(accountAddress);

  const signature = await withTimeout(freezeAccount(
    connection,
    wallet.keypair,
    accountPubkey,
    tokenMintPubkey,
    wallet.keypair
  ), 30000);

  return {
    success: true,
    signature,
    accountAddress,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleThawAccount(args: Record<string, unknown>) {
  const parsed = FreezeThawSchema.parse(args);
  const { walletName, tokenMint, accountAddress } = parsed;
  validateWalletName(walletName);
  validateAddress(tokenMint, "tokenMint");
  validateAddress(accountAddress, "accountAddress");

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);
  const accountPubkey = new PublicKey(accountAddress);

  const signature = await withTimeout(thawAccount(
    connection,
    wallet.keypair,
    accountPubkey,
    tokenMintPubkey,
    wallet.keypair
  ), 30000);

  return {
    success: true,
    signature,
    accountAddress,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleSetTokenAuthority(args: Record<string, unknown>) {
  const parsed = SetAuthoritySchema.parse(args);
  const { walletName, tokenMint, authorityType, newAuthority } = parsed;
  validateWalletName(walletName);
  validateAddress(tokenMint, "tokenMint");
  validateAuthorityType(authorityType);
  if (newAuthority !== undefined && newAuthority !== null) {
    validateAddress(newAuthority, "newAuthority");
  }

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);
  const newAuthorityPubkey = newAuthority ? new PublicKey(newAuthority) : null;

  const authorityTypeMap: Record<string, AuthorityType> = {
    "MintTokens": AuthorityType.MintTokens,
    "FreezeAccount": AuthorityType.FreezeAccount,
    "AccountOwner": AuthorityType.AccountOwner,
    "CloseAccount": AuthorityType.CloseAccount
  };

  const resolvedAuthType = authorityTypeMap[authorityType];

  const signature = await withTimeout(setAuthority(
    connection,
    wallet.keypair,
    tokenMintPubkey,
    wallet.keypair,
    resolvedAuthType,
    newAuthorityPubkey
  ), 30000);

  return {
    success: true,
    signature,
    authorityType,
    newAuthority: newAuthority || "revoked",
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleGetTokenSupply(args: Record<string, unknown>) {
  const parsed = TokenMintSchema.parse(args);
  const { tokenMint } = parsed;
  validateAddress(tokenMint, "tokenMint");

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);

  const mintInfo = await withTimeout(getMint(connection, tokenMintPubkey));
  const supply = Number(mintInfo.supply) / Math.pow(10, mintInfo.decimals);

  return {
    tokenMint,
    supply,
    rawSupply: mintInfo.supply.toString(),
    decimals: mintInfo.decimals,
    mintAuthority: mintInfo.mintAuthority ? mintInfo.mintAuthority.toString() : null,
    freezeAuthority: mintInfo.freezeAuthority ? mintInfo.freezeAuthority.toString() : null,
    isInitialized: mintInfo.isInitialized
  };
}

async function handleCloseTokenAccount(args: Record<string, unknown>) {
  const parsed = CloseTokenAccountSchema.parse(args);
  const { walletName, tokenMint, destinationAddress } = parsed;
  validateWalletName(walletName);
  validateAddress(tokenMint, "tokenMint");
  validateAddress(destinationAddress, "destinationAddress");

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);
  const destinationPubkey = new PublicKey(destinationAddress);

  const tokenAccount = await getAssociatedTokenAddress(
    tokenMintPubkey,
    wallet.keypair.publicKey
  );

  const signature = await withTimeout(closeAccount(
    connection,
    wallet.keypair,
    tokenAccount,
    destinationPubkey,
    wallet.keypair
  ), 30000);

  return {
    success: true,
    signature,
    closedAccount: tokenAccount.toString(),
    destination: destinationAddress,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleApproveDelegate(args: Record<string, unknown>) {
  const parsed = ApproveDelegateSchema.parse(args);
  const { walletName, tokenMint, delegateAddress, amount } = parsed;
  validateWalletName(walletName);
  validateAddress(tokenMint, "tokenMint");
  validateAddress(delegateAddress, "delegateAddress");
  validateAmount(amount, "delegate amount", MAX_TOKEN_AMOUNT);

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);
  const delegatePubkey = new PublicKey(delegateAddress);

  const mintInfo = await withTimeout(getMint(connection, tokenMintPubkey));
  const rawAmount = BigInt(Math.floor(amount * Math.pow(10, mintInfo.decimals)));

  const tokenAccount = await getAssociatedTokenAddress(
    tokenMintPubkey,
    wallet.keypair.publicKey
  );

  const signature = await withTimeout(approve(
    connection,
    wallet.keypair,
    tokenAccount,
    delegatePubkey,
    wallet.keypair,
    rawAmount
  ), 30000);

  return {
    success: true,
    signature,
    delegate: delegateAddress,
    amount,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleRevokeDelegate(args: Record<string, unknown>) {
  const parsed = RevokeDelegateSchema.parse(args);
  const { walletName, tokenMint } = parsed;
  validateWalletName(walletName);
  validateAddress(tokenMint, "tokenMint");

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);

  const tokenAccount = await getAssociatedTokenAddress(
    tokenMintPubkey,
    wallet.keypair.publicKey
  );

  const signature = await withTimeout(revoke(
    connection,
    wallet.keypair,
    tokenAccount,
    wallet.keypair
  ), 30000);

  return {
    success: true,
    signature,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

// Main server setup
const server = new Server(
  {
    name: "solana-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialize handler - REQUIRED for MCP protocol
server.setRequestHandler(InitializeRequestSchema, async (request) => {
  return {
    protocolVersion: "2024-11-05",
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: "solana-mcp-server",
      version: "1.0.0",
    },
  };
});

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args: Record<string, unknown> = rawArgs ?? {};

  try {
    let result;

    switch (name) {
      case "create_wallet":
        result = await handleCreateWallet(args);
        break;
      case "import_wallet":
        result = await handleImportWallet(args);
        break;
      case "list_wallets":
        result = await handleListWallets();
        break;
      case "get_balance":
        result = await handleGetBalance(args);
        break;
      case "get_token_balance":
        result = await handleGetTokenBalance(args);
        break;
      case "transfer_sol":
        result = await handleTransferSol(args);
        break;
      case "transfer_tokens":
        result = await handleTransferTokens(args);
        break;
      case "airdrop_sol":
        result = await handleAirdropSol(args);
        break;
      case "get_account_info":
        result = await handleGetAccountInfo(args);
        break;
      case "get_transaction":
        result = await handleGetTransaction(args);
        break;
      case "get_recent_blockhash":
        result = await handleGetRecentBlockhash();
        break;
      case "switch_network":
        result = await handleSwitchNetwork(args);
        break;
      case "get_network_info":
        result = await handleGetNetworkInfo();
        break;
      case "create_token_account":
        result = await handleCreateTokenAccount(args);
        break;
      case "get_token_accounts":
        result = await handleGetTokenAccounts(args);
        break;
      case "create_spl_token":
        result = await handleCreateSplToken(args);
        break;
      case "mint_tokens":
        result = await handleMintTokens(args);
        break;
      case "burn_tokens":
        result = await handleBurnTokens(args);
        break;
      case "freeze_account":
        result = await handleFreezeAccount(args);
        break;
      case "thaw_account":
        result = await handleThawAccount(args);
        break;
      case "set_token_authority":
        result = await handleSetTokenAuthority(args);
        break;
      case "get_token_supply":
        result = await handleGetTokenSupply(args);
        break;
      case "close_token_account":
        result = await handleCloseTokenAccount(args);
        break;
      case "approve_delegate":
        result = await handleApproveDelegate(args);
        break;
      case "revoke_delegate":
        result = await handleRevokeDelegate(args);
        break;
      default: {
        const safeName = typeof name === "string" ? name.slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, "") : "unknown";
        throw new Error(`Unknown tool: ${safeName}`);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${sanitizeError(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Export for Smithery
export default function createServer({ config }: { config?: Record<string, unknown> }): Server {
  // Config is accepted but not used — server uses environment-based defaults
  // Validate config shape if provided to prevent prototype pollution
  if (config !== undefined && config !== null && typeof config !== "object") {
    throw new Error("Invalid config: must be an object or undefined");
  }
  return server;
}

// Start server (for standalone mode)
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Solana MCP server running on stdio");
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Only run standalone if this is the main module (ES modules check)
const entryScript = typeof process !== "undefined" ? process.argv[1] ?? "" : "";
const isMainModule = entryScript.endsWith("/index.js") || entryScript === "index.js";
if (isMainModule) {
  main().catch((error) => {
    console.error("Server error:", sanitizeError(error));
    process.exit(1);
  });
}