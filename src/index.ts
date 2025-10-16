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

// Solana network configurations with environment variable support
const NETWORKS = {
  mainnet: process.env.SOLANA_MAINNET_RPC || "https://api.mainnet-beta.solana.com",
  devnet: process.env.SOLANA_DEVNET_RPC || "https://api.devnet.solana.com",
  testnet: process.env.SOLANA_TESTNET_RPC || "https://api.testnet.solana.com",
  localhost: process.env.SOLANA_LOCALHOST_RPC || "http://127.0.0.1:8899",
  custom: process.env.SOLANA_CUSTOM_RPC || ""
};

// Wallet storage (in production, use secure storage)
const wallets = new Map<string, { keypair: Keypair; name: string }>();

// Initialize connection
let connection: Connection;
let currentNetwork = "devnet";

function initializeConnection(network: string = "devnet") {
  currentNetwork = network;
  const rpcUrl = NETWORKS[network as keyof typeof NETWORKS] || NETWORKS.devnet;
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
  },
  {
    name: "health_check",
    description: "Check server and network connection health",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_transaction_history",
    description: "Get transaction history for a wallet",
    inputSchema: {
      type: "object",
      properties: {
        walletName: {
          type: "string",
          description: "Name of the wallet"
        },
        limit: {
          type: "number",
          description: "Number of transactions to fetch (default: 10, max: 100)"
        },
        before: {
          type: "string",
          description: "Transaction signature to paginate before"
        }
      },
      required: ["walletName"]
    }
  },
  {
    name: "get_token_info",
    description: "Get token metadata including name, symbol, logo, and price",
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
    name: "get_all_token_balances",
    description: "Get all SPL token balances for a wallet at once",
    inputSchema: {
      type: "object",
      properties: {
        walletName: {
          type: "string",
          description: "Name of the wallet"
        },
        includeZeroBalances: {
          type: "boolean",
          description: "Include tokens with zero balance (default: false)"
        }
      },
      required: ["walletName"]
    }
  }
];

// Tool handlers
async function handleCreateWallet(args: any) {
  const { name } = args;
  
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
      privateKey: bs58.encode(keypair.secretKey)
    }
  };
}

async function handleImportWallet(args: any) {
  const { name, privateKey } = args;
  
  if (wallets.has(name)) {
    throw new Error(`Wallet with name '${name}' already exists`);
  }

  try {
    const secretKey = bs58.decode(privateKey);
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
    throw new Error(`Invalid private key: ${error}`);
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

async function handleGetBalance(args: any) {
  const { walletName } = args;
  
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

async function handleGetTokenBalance(args: any) {
  const { walletName, tokenMint } = args;
  
  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  try {
    const tokenMintPubkey = new PublicKey(tokenMint);
    const tokenAccount = await getAssociatedTokenAddress(tokenMintPubkey, wallet.keypair.publicKey);
    
    const accountInfo = await getAccount(connection, tokenAccount);
    
    return {
      wallet: walletName,
      tokenMint: tokenMint,
      balance: accountInfo.amount.toString(),
      decimals: accountInfo.mint.toString()
    };
  } catch (error) {
    return {
      wallet: walletName,
      tokenMint: tokenMint,
      balance: "0",
      error: "Token account not found or error retrieving balance"
    };
  }
}

async function handleTransferSol(args: any) {
  const { fromWallet, toAddress, amount } = args;
  
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

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.keypair.publicKey;

  transaction.sign(wallet.keypair);

  const signature = await connection.sendTransaction(transaction, [wallet.keypair]);

  return {
    success: true,
    signature,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleTransferTokens(args: any) {
  const { fromWallet, toAddress, tokenMint, amount } = args;
  
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
  try {
    await getAccount(connection, toTokenAccount);
  } catch {
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

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.keypair.publicKey;

  transaction.sign(wallet.keypair);

  const signature = await connection.sendTransaction(transaction, [wallet.keypair]);

  return {
    success: true,
    signature,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleAirdropSol(args: any) {
  const { walletName, amount = 1 } = args;
  
  if (currentNetwork === "mainnet") {
    throw new Error("Airdrop is not available on mainnet");
  }

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
  const signature = await connection.requestAirdrop(wallet.keypair.publicKey, lamports);

  return {
    success: true,
    signature,
    amount: amount,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleGetAccountInfo(args: any) {
  const { address } = args;
  
  ensureConnection();
  const pubkey = new PublicKey(address);
  const accountInfo = await connection.getAccountInfo(pubkey);

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

async function handleGetTransaction(args: any) {
  const { signature } = args;
  
  ensureConnection();
  const transaction = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0
  });

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
  const { blockhash } = await connection.getLatestBlockhash();
  
  return {
    blockhash,
    network: currentNetwork
  };
}

async function handleSwitchNetwork(args: any) {
  const { network } = args;
  
  initializeConnection(network);
  
  return {
    success: true,
    network: currentNetwork,
    rpcUrl: NETWORKS[network as keyof typeof NETWORKS]
  };
}

async function handleGetNetworkInfo() {
  ensureConnection();
  const version = await connection.getVersion();
  const epochInfo = await connection.getEpochInfo();
  
  return {
    network: currentNetwork,
    rpcUrl: NETWORKS[currentNetwork as keyof typeof NETWORKS],
    version: version["solana-core"],
    epoch: epochInfo.epoch,
    slotIndex: epochInfo.slotIndex,
    slotsInEpoch: epochInfo.slotsInEpoch
  };
}

async function handleCreateTokenAccount(args: any) {
  const { walletName, tokenMint } = args;
  
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

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.keypair.publicKey;

  transaction.sign(wallet.keypair);

  const signature = await connection.sendTransaction(transaction, [wallet.keypair]);

  return {
    success: true,
    tokenAccount: tokenAccount.toString(),
    signature,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleGetTokenAccounts(args: any) {
  const { walletName } = args;
  
  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenAccounts = await connection.getTokenAccountsByOwner(wallet.keypair.publicKey, {
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
  });

  const accounts = tokenAccounts.value.map(account => {
    const data = account.account.data as any;
    return {
      address: account.pubkey.toString(),
      mint: data.parsed?.info?.mint || 'unknown',
      amount: data.parsed?.info?.tokenAmount?.uiAmount || 0,
      decimals: data.parsed?.info?.tokenAmount?.decimals || 0
    };
  });

  return {
    wallet: walletName,
    tokenAccounts: accounts,
    count: accounts.length
  };
}

async function handleCreateSplToken(args: any) {
  const { walletName, decimals = 9, freezeAuthority = false } = args;

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();

  const freezeAuthorityPubkey = freezeAuthority ? wallet.keypair.publicKey : null;

  const mint = await createMint(
    connection,
    wallet.keypair,
    wallet.keypair.publicKey,
    freezeAuthorityPubkey,
    decimals
  );

  return {
    success: true,
    tokenMint: mint.toString(),
    decimals,
    mintAuthority: wallet.keypair.publicKey.toString(),
    freezeAuthority: freezeAuthorityPubkey ? freezeAuthorityPubkey.toString() : null,
    explorerUrl: `https://explorer.solana.com/address/${mint.toString()}?cluster=${currentNetwork}`
  };
}

async function handleMintTokens(args: any) {
  const { walletName, tokenMint, destinationAddress, amount } = args;

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);
  const destinationPubkey = new PublicKey(destinationAddress);

  const mintInfo = await getMint(connection, tokenMintPubkey);
  const rawAmount = BigInt(Math.floor(amount * Math.pow(10, mintInfo.decimals)));

  const destinationTokenAccount = await getAssociatedTokenAddress(
    tokenMintPubkey,
    destinationPubkey
  );

  // Check if destination token account exists, create if not
  try {
    await getAccount(connection, destinationTokenAccount);
  } catch {
    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.keypair.publicKey,
        destinationTokenAccount,
        destinationPubkey,
        tokenMintPubkey
      )
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.keypair.publicKey;
    transaction.sign(wallet.keypair);

    await connection.sendTransaction(transaction, [wallet.keypair]);
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for account creation
  }

  const signature = await mintTo(
    connection,
    wallet.keypair,
    tokenMintPubkey,
    destinationTokenAccount,
    wallet.keypair,
    rawAmount
  );

  return {
    success: true,
    signature,
    amount,
    tokenMint: tokenMint,
    destination: destinationAddress,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleBurnTokens(args: any) {
  const { walletName, tokenMint, amount } = args;

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);

  const mintInfo = await getMint(connection, tokenMintPubkey);
  const rawAmount = BigInt(Math.floor(amount * Math.pow(10, mintInfo.decimals)));

  const tokenAccount = await getAssociatedTokenAddress(
    tokenMintPubkey,
    wallet.keypair.publicKey
  );

  const signature = await burn(
    connection,
    wallet.keypair,
    tokenAccount,
    tokenMintPubkey,
    wallet.keypair,
    rawAmount
  );

  return {
    success: true,
    signature,
    amount,
    tokenMint: tokenMint,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleFreezeAccount(args: any) {
  const { walletName, tokenMint, accountAddress } = args;

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);
  const accountPubkey = new PublicKey(accountAddress);

  const signature = await freezeAccount(
    connection,
    wallet.keypair,
    accountPubkey,
    tokenMintPubkey,
    wallet.keypair
  );

  return {
    success: true,
    signature,
    accountAddress,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleThawAccount(args: any) {
  const { walletName, tokenMint, accountAddress } = args;

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);
  const accountPubkey = new PublicKey(accountAddress);

  const signature = await thawAccount(
    connection,
    wallet.keypair,
    accountPubkey,
    tokenMintPubkey,
    wallet.keypair
  );

  return {
    success: true,
    signature,
    accountAddress,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleSetTokenAuthority(args: any) {
  const { walletName, tokenMint, authorityType, newAuthority } = args;

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);
  const newAuthorityPubkey = newAuthority ? new PublicKey(newAuthority) : null;

  const authorityTypeMap: { [key: string]: AuthorityType } = {
    "MintTokens": AuthorityType.MintTokens,
    "FreezeAccount": AuthorityType.FreezeAccount,
    "AccountOwner": AuthorityType.AccountOwner,
    "CloseAccount": AuthorityType.CloseAccount
  };

  const signature = await setAuthority(
    connection,
    wallet.keypair,
    tokenMintPubkey,
    wallet.keypair,
    authorityTypeMap[authorityType],
    newAuthorityPubkey
  );

  return {
    success: true,
    signature,
    authorityType,
    newAuthority: newAuthority || "revoked",
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleGetTokenSupply(args: any) {
  const { tokenMint } = args;

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);

  const mintInfo = await getMint(connection, tokenMintPubkey);
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

async function handleCloseTokenAccount(args: any) {
  const { walletName, tokenMint, destinationAddress } = args;

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

  const signature = await closeAccount(
    connection,
    wallet.keypair,
    tokenAccount,
    destinationPubkey,
    wallet.keypair
  );

  return {
    success: true,
    signature,
    closedAccount: tokenAccount.toString(),
    destination: destinationAddress,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleApproveDelegate(args: any) {
  const { walletName, tokenMint, delegateAddress, amount } = args;

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const tokenMintPubkey = new PublicKey(tokenMint);
  const delegatePubkey = new PublicKey(delegateAddress);

  const mintInfo = await getMint(connection, tokenMintPubkey);
  const rawAmount = BigInt(Math.floor(amount * Math.pow(10, mintInfo.decimals)));

  const tokenAccount = await getAssociatedTokenAddress(
    tokenMintPubkey,
    wallet.keypair.publicKey
  );

  const signature = await approve(
    connection,
    wallet.keypair,
    tokenAccount,
    delegatePubkey,
    wallet.keypair,
    rawAmount
  );

  return {
    success: true,
    signature,
    delegate: delegateAddress,
    amount,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
}

async function handleRevokeDelegate(args: any) {
  const { walletName, tokenMint } = args;

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

  const signature = await revoke(
    connection,
    wallet.keypair,
    tokenAccount,
    wallet.keypair
  );

  return {
    success: true,
    signature,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${currentNetwork}`
  };
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

async function handleGetTransactionHistory(args: any) {
  const { walletName, limit = 10, before } = args;

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

  ensureConnection();
  const options: any = { limit: Math.min(limit, 100) };
  if (before) {
    options.before = before;
  }

  const signatures = await connection.getSignaturesForAddress(
    wallet.keypair.publicKey,
    options
  );

  const transactions = await Promise.all(
    signatures.map(async (sig) => {
      try {
        const tx = await connection.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed"
        });
        return {
          signature: sig.signature,
          slot: sig.slot,
          timestamp: sig.blockTime,
          status: sig.err ? "failed" : "success",
          fee: tx?.meta?.fee,
          err: sig.err,
          explorerUrl: `https://explorer.solana.com/tx/${sig.signature}?cluster=${currentNetwork}`
        };
      } catch (error) {
        return {
          signature: sig.signature,
          slot: sig.slot,
          timestamp: sig.blockTime,
          status: sig.err ? "failed" : "success",
          error: "Failed to fetch transaction details",
          explorerUrl: `https://explorer.solana.com/tx/${sig.signature}?cluster=${currentNetwork}`
        };
      }
    })
  );

  return {
    wallet: walletName,
    address: wallet.keypair.publicKey.toString(),
    transactions,
    count: transactions.length,
    hasMore: transactions.length === options.limit
  };
}

async function handleGetTokenInfo(args: any) {
  const { tokenMint } = args;

  try {
    // Fetch from Jupiter token list
    const response = await withTimeout(
      fetch('https://token.jup.ag/strict'),
      10000
    );
    const tokens = await response.json();
    const tokenInfo = tokens.find((t: any) => t.address === tokenMint);

    if (!tokenInfo) {
      return {
        tokenMint,
        found: false,
        message: "Token not found in Jupiter token list"
      };
    }

    // Get price from Jupiter (optional, may fail for some tokens)
    let price = null;
    try {
      const priceResponse = await withTimeout(
        fetch(`https://price.jup.ag/v6/price?ids=${tokenMint}`),
        5000
      );
      const priceData = await priceResponse.json();
      price = priceData.data?.[tokenMint]?.price || null;
    } catch {
      // Price fetch failed, continue without price
    }

    return {
      address: tokenInfo.address,
      name: tokenInfo.name,
      symbol: tokenInfo.symbol,
      decimals: tokenInfo.decimals,
      logoURI: tokenInfo.logoURI,
      price,
      found: true
    };
  } catch (error) {
    return {
      tokenMint,
      found: false,
      error: error instanceof Error ? error.message : "Failed to fetch token info"
    };
  }
}

async function handleGetAllTokenBalances(args: any) {
  const { walletName, includeZeroBalances = false } = args;

  const wallet = wallets.get(walletName);
  if (!wallet) {
    throw new Error(`Wallet '${walletName}' not found`);
  }

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
        rawBalance: data.tokenAmount.amount,
        account: account.pubkey.toString()
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
  const { name, arguments: args } = request.params;

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
      case "health_check":
        result = await handleHealthCheck();
        break;
      case "get_transaction_history":
        result = await handleGetTransactionHistory(args);
        break;
      case "get_token_info":
        result = await handleGetTokenInfo(args);
        break;
      case "get_all_token_balances":
        result = await handleGetAllTokenBalances(args);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
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
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Export for Smithery
export default function createServer({ config }: { config?: any }): Server {
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
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('index.js')) {
  main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}