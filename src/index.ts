#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createTransferInstruction, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount } from "@solana/spl-token";
import bs58 from "bs58";
import { z } from "zod";

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

// Start server
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

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});