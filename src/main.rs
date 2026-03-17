#![recursion_limit = "512"]

use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::BufRead;
use tracing::info;

const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

static NETWORKS: &[(&str, &str)] = &[
    ("mainnet", "https://api.mainnet-beta.solana.com"),
    ("devnet", "https://api.devnet.solana.com"),
    ("testnet", "https://api.testnet.solana.com"),
    ("localhost", "http://127.0.0.1:8899"),
];

fn rpc_url(network: &str) -> String {
    NETWORKS
        .iter()
        .find(|(n, _)| *n == network)
        .map(|(_, u)| u.to_string())
        .unwrap_or_else(|| "https://api.devnet.solana.com".to_string())
}

struct Wallet {
    name: String,
    secret_key: [u8; 64],
    public_key: [u8; 32],
    address: String,
}

struct AppState {
    wallets: HashMap<String, Wallet>,
    current_network: String,
    client: reqwest::Client,
}

impl AppState {
    fn new() -> Self {
        Self {
            wallets: HashMap::new(),
            current_network: "devnet".to_string(),
            client: reqwest::Client::new(),
        }
    }

    fn rpc_url(&self) -> String {
        rpc_url(&self.current_network)
    }

    async fn rpc(&self, method: &str, params: Value) -> Result<Value, String> {
        let body = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        });
        let resp = self
            .client
            .post(self.rpc_url())
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("RPC error: {e}"))?;
        let val: Value = resp.json().await.map_err(|e| format!("Parse error: {e}"))?;
        if let Some(err) = val.get("error") {
            return Err(format!("RPC error: {}", err));
        }
        Ok(val["result"].clone())
    }

    fn get_wallet(&self, name: &str) -> Result<&Wallet, String> {
        self.wallets
            .get(name)
            .ok_or_else(|| format!("Wallet '{}' not found", name))
    }
}

fn generate_keypair() -> ([u8; 64], [u8; 32], String) {
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();
    let pub_bytes: [u8; 32] = verifying_key.to_bytes();
    let mut secret = [0u8; 64];
    secret[..32].copy_from_slice(&signing_key.to_bytes());
    secret[32..].copy_from_slice(&pub_bytes);
    let address = bs58::encode(&pub_bytes).into_string();
    (secret, pub_bytes, address)
}

fn keypair_from_secret(secret: &[u8; 64]) -> ed25519_dalek::SigningKey {
    let mut key_bytes = [0u8; 32];
    key_bytes.copy_from_slice(&secret[..32]);
    ed25519_dalek::SigningKey::from_bytes(&key_bytes)
}

#[derive(Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

fn tool_definitions() -> Value {
    json!([
        {
            "name": "create_wallet",
            "description": "Create a new Solana wallet",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name for the wallet"}
                },
                "required": ["name"]
            }
        },
        {
            "name": "import_wallet",
            "description": "Import an existing wallet from private key",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name for the wallet"},
                    "privateKey": {"type": "string", "description": "Private key in base58 format (64-byte keypair)"}
                },
                "required": ["name", "privateKey"]
            }
        },
        {
            "name": "list_wallets",
            "description": "List all created/imported wallets",
            "inputSchema": {"type": "object", "properties": {}}
        },
        {
            "name": "get_balance",
            "description": "Get SOL balance for a wallet",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "walletName": {"type": "string", "description": "Name of the wallet"}
                },
                "required": ["walletName"]
            }
        },
        {
            "name": "get_token_balance",
            "description": "Get SPL token balance for a wallet",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "walletName": {"type": "string", "description": "Name of the wallet"},
                    "tokenMint": {"type": "string", "description": "Token mint address"}
                },
                "required": ["walletName", "tokenMint"]
            }
        },
        {
            "name": "transfer_sol",
            "description": "Transfer SOL between wallets",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "fromWallet": {"type": "string", "description": "Name of the sender wallet"},
                    "toAddress": {"type": "string", "description": "Recipient address"},
                    "amount": {"type": "number", "description": "Amount in SOL"}
                },
                "required": ["fromWallet", "toAddress", "amount"]
            }
        },
        {
            "name": "transfer_tokens",
            "description": "Transfer SPL tokens between wallets",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "fromWallet": {"type": "string", "description": "Name of the sender wallet"},
                    "toAddress": {"type": "string", "description": "Recipient address"},
                    "tokenMint": {"type": "string", "description": "Token mint address"},
                    "amount": {"type": "number", "description": "Amount of tokens to transfer"}
                },
                "required": ["fromWallet", "toAddress", "tokenMint", "amount"]
            }
        },
        {
            "name": "airdrop_sol",
            "description": "Request SOL airdrop for testing (devnet/testnet only)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "walletName": {"type": "string", "description": "Name of the wallet"},
                    "amount": {"type": "number", "description": "Amount of SOL to airdrop (default: 1)"}
                },
                "required": ["walletName"]
            }
        },
        {
            "name": "get_account_info",
            "description": "Get detailed account information",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "address": {"type": "string", "description": "Account address"}
                },
                "required": ["address"]
            }
        },
        {
            "name": "get_transaction",
            "description": "Get transaction details by signature",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "signature": {"type": "string", "description": "Transaction signature"}
                },
                "required": ["signature"]
            }
        },
        {
            "name": "get_recent_blockhash",
            "description": "Get recent blockhash for transaction building",
            "inputSchema": {"type": "object", "properties": {}}
        },
        {
            "name": "switch_network",
            "description": "Switch Solana network",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "network": {"type": "string", "enum": ["mainnet", "devnet", "testnet", "localhost"], "description": "Network to switch to"}
                },
                "required": ["network"]
            }
        },
        {
            "name": "get_network_info",
            "description": "Get current network information",
            "inputSchema": {"type": "object", "properties": {}}
        },
        {
            "name": "create_token_account",
            "description": "Create associated token account for SPL tokens",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "walletName": {"type": "string", "description": "Name of the wallet"},
                    "tokenMint": {"type": "string", "description": "Token mint address"}
                },
                "required": ["walletName", "tokenMint"]
            }
        },
        {
            "name": "get_token_accounts",
            "description": "Get all token accounts for a wallet",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "walletName": {"type": "string", "description": "Name of the wallet"}
                },
                "required": ["walletName"]
            }
        },
        {
            "name": "create_spl_token",
            "description": "Create a new SPL token with specified decimals",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "walletName": {"type": "string", "description": "Name of the wallet that will be the mint authority"},
                    "decimals": {"type": "number", "description": "Number of decimal places (default: 9)"},
                    "freezeAuthority": {"type": "boolean", "description": "Whether to enable freeze authority (default: false)"}
                },
                "required": ["walletName"]
            }
        },
        {
            "name": "mint_tokens",
            "description": "Mint tokens to a specific account",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "walletName": {"type": "string", "description": "Name of the wallet with mint authority"},
                    "tokenMint": {"type": "string", "description": "Token mint address"},
                    "destinationAddress": {"type": "string", "description": "Destination wallet address"},
                    "amount": {"type": "number", "description": "Amount of tokens to mint"}
                },
                "required": ["walletName", "tokenMint", "destinationAddress", "amount"]
            }
        },
        {
            "name": "burn_tokens",
            "description": "Burn tokens from a wallet",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "walletName": {"type": "string", "description": "Name of the wallet to burn tokens from"},
                    "tokenMint": {"type": "string", "description": "Token mint address"},
                    "amount": {"type": "number", "description": "Amount of tokens to burn"}
                },
                "required": ["walletName", "tokenMint", "amount"]
            }
        },
        {
            "name": "freeze_account",
            "description": "Freeze a token account to prevent transfers",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "walletName": {"type": "string", "description": "Name of the wallet with freeze authority"},
                    "tokenMint": {"type": "string", "description": "Token mint address"},
                    "accountAddress": {"type": "string", "description": "Address of the token account to freeze"}
                },
                "required": ["walletName", "tokenMint", "accountAddress"]
            }
        },
        {
            "name": "thaw_account",
            "description": "Thaw a frozen token account to allow transfers",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "walletName": {"type": "string", "description": "Name of the wallet with freeze authority"},
                    "tokenMint": {"type": "string", "description": "Token mint address"},
                    "accountAddress": {"type": "string", "description": "Address of the token account to thaw"}
                },
                "required": ["walletName", "tokenMint", "accountAddress"]
            }
        },
        {
            "name": "set_token_authority",
            "description": "Set or change authority for a token mint or account",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "walletName": {"type": "string", "description": "Name of the wallet with current authority"},
                    "tokenMint": {"type": "string", "description": "Token mint address"},
                    "authorityType": {"type": "string", "enum": ["MintTokens", "FreezeAccount", "AccountOwner", "CloseAccount"], "description": "Type of authority to set"},
                    "newAuthority": {"type": "string", "description": "Address of new authority (omit to revoke)"}
                },
                "required": ["walletName", "tokenMint", "authorityType"]
            }
        },
        {
            "name": "get_token_supply",
            "description": "Get the total supply of a token",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tokenMint": {"type": "string", "description": "Token mint address"}
                },
                "required": ["tokenMint"]
            }
        },
        {
            "name": "close_token_account",
            "description": "Close a token account and reclaim rent",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "walletName": {"type": "string", "description": "Name of the wallet that owns the account"},
                    "tokenMint": {"type": "string", "description": "Token mint address"},
                    "destinationAddress": {"type": "string", "description": "Address to send remaining lamports to"}
                },
                "required": ["walletName", "tokenMint", "destinationAddress"]
            }
        },
        {
            "name": "approve_delegate",
            "description": "Approve a delegate to transfer tokens on your behalf",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "walletName": {"type": "string", "description": "Name of the wallet that owns the tokens"},
                    "tokenMint": {"type": "string", "description": "Token mint address"},
                    "delegateAddress": {"type": "string", "description": "Address of the delegate"},
                    "amount": {"type": "number", "description": "Maximum amount delegate can transfer"}
                },
                "required": ["walletName", "tokenMint", "delegateAddress", "amount"]
            }
        },
        {
            "name": "revoke_delegate",
            "description": "Revoke a delegate's authority to transfer tokens",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "walletName": {"type": "string", "description": "Name of the wallet that owns the tokens"},
                    "tokenMint": {"type": "string", "description": "Token mint address"}
                },
                "required": ["walletName", "tokenMint"]
            }
        }
    ])
}

async fn call_tool(state: &mut AppState, name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "create_wallet" => {
            let wname = args["name"].as_str().ok_or("name required")?;
            if state.wallets.contains_key(wname) {
                return Err(format!("Wallet '{}' already exists", wname));
            }
            let (secret, pubkey, address) = generate_keypair();
            let pk_b58 = bs58::encode(&secret).into_string();
            state.wallets.insert(
                wname.to_string(),
                Wallet {
                    name: wname.to_string(),
                    secret_key: secret,
                    public_key: pubkey,
                    address: address.clone(),
                },
            );
            Ok(
                json!({"success": true, "wallet": {"name": wname, "address": address, "privateKey": pk_b58}}),
            )
        }
        "import_wallet" => {
            let wname = args["name"].as_str().ok_or("name required")?;
            let pk_str = args["privateKey"].as_str().ok_or("privateKey required")?;
            if state.wallets.contains_key(wname) {
                return Err(format!("Wallet '{}' already exists", wname));
            }
            let decoded = bs58::decode(pk_str)
                .into_vec()
                .map_err(|e| format!("Invalid base58: {e}"))?;
            if decoded.len() != 64 {
                return Err("Private key must be 64 bytes (keypair)".to_string());
            }
            let mut secret = [0u8; 64];
            secret.copy_from_slice(&decoded);
            let mut pubkey = [0u8; 32];
            pubkey.copy_from_slice(&secret[32..]);
            let address = bs58::encode(&pubkey).into_string();
            state.wallets.insert(
                wname.to_string(),
                Wallet {
                    name: wname.to_string(),
                    secret_key: secret,
                    public_key: pubkey,
                    address: address.clone(),
                },
            );
            Ok(json!({"success": true, "wallet": {"name": wname, "address": address}}))
        }
        "list_wallets" => {
            let list: Vec<Value> = state
                .wallets
                .values()
                .map(|w| json!({"name": w.name, "address": w.address}))
                .collect();
            Ok(json!({"wallets": list, "count": list.len()}))
        }
        "get_balance" => {
            let wname = args["walletName"].as_str().ok_or("walletName required")?;
            let wallet = state.get_wallet(wname)?;
            let result = state.rpc("getBalance", json!([wallet.address])).await?;
            let lamports = result["value"].as_u64().unwrap_or(0);
            let sol = lamports as f64 / LAMPORTS_PER_SOL as f64;
            Ok(
                json!({"wallet": wname, "address": wallet.address, "balance": {"lamports": lamports, "sol": sol}}),
            )
        }
        "get_token_balance" => {
            let wname = args["walletName"].as_str().ok_or("walletName required")?;
            let token_mint = args["tokenMint"].as_str().ok_or("tokenMint required")?;
            let wallet = state.get_wallet(wname)?;
            let result = state
                .rpc(
                    "getTokenAccountsByOwner",
                    json!([
                        wallet.address,
                        {"mint": token_mint},
                        {"encoding": "jsonParsed"}
                    ]),
                )
                .await?;
            let accounts = result["value"].as_array();
            if let Some(accts) = accounts
                && let Some(first) = accts.first()
            {
                let info = &first["account"]["data"]["parsed"]["info"];
                let amount = info["tokenAmount"]["uiAmountString"]
                    .as_str()
                    .unwrap_or("0");
                return Ok(json!({"wallet": wname, "tokenMint": token_mint, "balance": amount}));
            }
            Ok(
                json!({"wallet": wname, "tokenMint": token_mint, "balance": "0", "error": "Token account not found"}),
            )
        }
        "transfer_sol" => {
            let from = args["fromWallet"].as_str().ok_or("fromWallet required")?;
            let to = args["toAddress"].as_str().ok_or("toAddress required")?;
            let amount = args["amount"].as_f64().ok_or("amount required")?;
            let wallet = state.get_wallet(from)?;
            let lamports = (amount * LAMPORTS_PER_SOL as f64) as u64;

            let bh_result = state.rpc("getLatestBlockhash", json!([])).await?;
            let blockhash = bh_result["value"]["blockhash"]
                .as_str()
                .ok_or("No blockhash")?;

            let from_bytes = bs58::decode(&wallet.address)
                .into_vec()
                .map_err(|e| format!("{e}"))?;
            let to_bytes = bs58::decode(to).into_vec().map_err(|e| format!("{e}"))?;

            // Build a SystemProgram.Transfer transaction
            let system_program = [0u8; 32];
            // Compact array: 1 signature placeholder
            let mut tx_message: Vec<u8> = Vec::new();
            // Message header: 1 signer, 0 readonly signed, 1 readonly unsigned
            tx_message.push(1); // num_required_signatures
            tx_message.push(0); // num_readonly_signed_accounts
            tx_message.push(1); // num_readonly_unsigned_accounts
            // Account keys: from, to, system_program
            tx_message.push(3); // compact array length
            tx_message.extend_from_slice(&from_bytes);
            tx_message.extend_from_slice(&to_bytes);
            tx_message.extend_from_slice(&system_program);
            // Recent blockhash
            let bh_bytes = bs58::decode(blockhash)
                .into_vec()
                .map_err(|e| format!("{e}"))?;
            tx_message.extend_from_slice(&bh_bytes);
            // Instructions: 1 instruction
            tx_message.push(1); // compact array length
            // Instruction: program_id_index=2 (system program)
            tx_message.push(2);
            // accounts: 2 accounts [0, 1]
            tx_message.push(2);
            tx_message.push(0);
            tx_message.push(1);
            // data: Transfer instruction (index 2 as u32 LE + lamports as u64 LE)
            let mut ix_data = Vec::new();
            ix_data.extend_from_slice(&2u32.to_le_bytes()); // Transfer = 2
            ix_data.extend_from_slice(&lamports.to_le_bytes());
            tx_message.push(ix_data.len() as u8);
            tx_message.extend_from_slice(&ix_data);

            // Sign the message
            let signing_key = keypair_from_secret(&wallet.secret_key);
            use ed25519_dalek::Signer;
            let signature = signing_key.sign(&tx_message);

            // Build full transaction: num_sigs + sig + message
            let mut full_tx: Vec<u8> = Vec::new();
            full_tx.push(1); // 1 signature
            full_tx.extend_from_slice(&signature.to_bytes());
            full_tx.extend_from_slice(&tx_message);

            let tx_b64 = base64_encode(&full_tx);
            let send_result = state
                .rpc("sendTransaction", json!([tx_b64, {"encoding": "base64"}]))
                .await?;
            let sig_str = send_result.as_str().unwrap_or("unknown");
            Ok(json!({
                "success": true,
                "signature": sig_str,
                "explorerUrl": format!("https://explorer.solana.com/tx/{}?cluster={}", sig_str, state.current_network)
            }))
        }
        "transfer_tokens" => {
            // SPL token transfers require complex instruction building
            // For now, delegate to the Solana CLI approach or return guidance
            Ok(json!({
                "info": "SPL token transfers require building complex Token Program instructions. Use the Solana CLI: spl-token transfer <TOKEN_MINT> <AMOUNT> <RECIPIENT> --owner <KEYPAIR>",
                "network": state.current_network
            }))
        }
        "airdrop_sol" => {
            let wname = args["walletName"].as_str().ok_or("walletName required")?;
            let amount = args["amount"].as_f64().unwrap_or(1.0);
            if state.current_network == "mainnet" {
                return Err("Airdrop is not available on mainnet".to_string());
            }
            let wallet = state.get_wallet(wname)?;
            let lamports = (amount * LAMPORTS_PER_SOL as f64) as u64;
            let result = state
                .rpc("requestAirdrop", json!([wallet.address, lamports]))
                .await?;
            let sig = result.as_str().unwrap_or("unknown");
            Ok(json!({
                "success": true, "signature": sig, "amount": amount,
                "explorerUrl": format!("https://explorer.solana.com/tx/{}?cluster={}", sig, state.current_network)
            }))
        }
        "get_account_info" => {
            let address = args["address"].as_str().ok_or("address required")?;
            let result = state
                .rpc(
                    "getAccountInfo",
                    json!([address, {"encoding": "jsonParsed"}]),
                )
                .await?;
            if result["value"].is_null() {
                return Ok(json!({"address": address, "exists": false}));
            }
            let val = &result["value"];
            Ok(json!({
                "address": address,
                "exists": true,
                "lamports": val["lamports"],
                "owner": val["owner"],
                "executable": val["executable"],
                "rentEpoch": val["rentEpoch"],
                "dataLength": val["data"].as_array().map(|a| a.len()).unwrap_or(0)
            }))
        }
        "get_transaction" => {
            let sig = args["signature"].as_str().ok_or("signature required")?;
            let result = state
                .rpc(
                    "getTransaction",
                    json!([sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}]),
                )
                .await?;
            if result.is_null() {
                return Err("Transaction not found".to_string());
            }
            Ok(json!({
                "signature": sig,
                "slot": result["slot"],
                "blockTime": result["blockTime"],
                "fee": result["meta"]["fee"],
                "success": result["meta"]["err"].is_null(),
                "error": result["meta"]["err"]
            }))
        }
        "get_recent_blockhash" => {
            let result = state.rpc("getLatestBlockhash", json!([])).await?;
            Ok(json!({"blockhash": result["value"]["blockhash"], "network": state.current_network}))
        }
        "switch_network" => {
            let network = args["network"].as_str().ok_or("network required")?;
            state.current_network = network.to_string();
            Ok(json!({"success": true, "network": network, "rpcUrl": rpc_url(network)}))
        }
        "get_network_info" => {
            let version = state.rpc("getVersion", json!([])).await?;
            let epoch = state.rpc("getEpochInfo", json!([])).await?;
            Ok(json!({
                "network": state.current_network,
                "rpcUrl": state.rpc_url(),
                "version": version["solana-core"],
                "epoch": epoch["epoch"],
                "slotIndex": epoch["slotIndex"],
                "slotsInEpoch": epoch["slotsInEpoch"]
            }))
        }
        "create_token_account" => Ok(
            json!({"info": "Use Solana CLI: spl-token create-account <TOKEN_MINT>", "network": state.current_network}),
        ),
        "get_token_accounts" => {
            let wname = args["walletName"].as_str().ok_or("walletName required")?;
            let wallet = state.get_wallet(wname)?;
            let result = state
                .rpc(
                    "getTokenAccountsByOwner",
                    json!([
                        wallet.address,
                        {"programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"},
                        {"encoding": "jsonParsed"}
                    ]),
                )
                .await?;
            let accounts: Vec<Value> = result["value"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .map(|a| {
                    let info = &a["account"]["data"]["parsed"]["info"];
                    json!({
                        "address": a["pubkey"],
                        "mint": info["mint"],
                        "amount": info["tokenAmount"]["uiAmountString"],
                        "decimals": info["tokenAmount"]["decimals"]
                    })
                })
                .collect();
            Ok(json!({"wallet": wname, "tokenAccounts": accounts, "count": accounts.len()}))
        }
        "create_spl_token" => Ok(
            json!({"info": "Use Solana CLI: spl-token create-token --decimals <N>", "network": state.current_network}),
        ),
        "mint_tokens" => Ok(
            json!({"info": "Use Solana CLI: spl-token mint <TOKEN_MINT> <AMOUNT> <RECIPIENT>", "network": state.current_network}),
        ),
        "burn_tokens" => Ok(
            json!({"info": "Use Solana CLI: spl-token burn <TOKEN_ACCOUNT> <AMOUNT>", "network": state.current_network}),
        ),
        "freeze_account" => Ok(
            json!({"info": "Use Solana CLI: spl-token freeze <TOKEN_ACCOUNT>", "network": state.current_network}),
        ),
        "thaw_account" => Ok(
            json!({"info": "Use Solana CLI: spl-token thaw <TOKEN_ACCOUNT>", "network": state.current_network}),
        ),
        "set_token_authority" => {
            let auth_type = args["authorityType"].as_str().unwrap_or("MintTokens");
            Ok(
                json!({"info": format!("Use Solana CLI: spl-token authorize <TOKEN_MINT> {} <NEW_AUTHORITY>", auth_type), "network": state.current_network}),
            )
        }
        "get_token_supply" => {
            let mint = args["tokenMint"].as_str().ok_or("tokenMint required")?;
            let result = state.rpc("getTokenSupply", json!([mint])).await?;
            let val = &result["value"];
            Ok(json!({
                "tokenMint": mint,
                "supply": val["uiAmountString"],
                "rawSupply": val["amount"],
                "decimals": val["decimals"]
            }))
        }
        "close_token_account" => Ok(
            json!({"info": "Use Solana CLI: spl-token close <TOKEN_ACCOUNT>", "network": state.current_network}),
        ),
        "approve_delegate" => Ok(
            json!({"info": "Use Solana CLI: spl-token approve <TOKEN_ACCOUNT> <AMOUNT> <DELEGATE>", "network": state.current_network}),
        ),
        "revoke_delegate" => Ok(
            json!({"info": "Use Solana CLI: spl-token revoke <TOKEN_ACCOUNT>", "network": state.current_network}),
        ),
        _ => Err(format!("Unknown tool: {name}")),
    }
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .with_writer(std::io::stderr)
        .init();
    info!("solana-mcp-server starting on stdio");

    let mut state = AppState::new();
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();

    let mut line = String::new();
    loop {
        line.clear();
        if stdin.lock().read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let req: JsonRpcRequest = match serde_json::from_str(trimmed) {
            Ok(r) => r,
            Err(_) => continue,
        };

        let response = match req.method.as_str() {
            "initialize" => json!({
                "jsonrpc": "2.0",
                "id": req.id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "solana-mcp-server", "version": "0.1.0"}
                }
            }),
            "notifications/initialized" => continue,
            "tools/list" => json!({
                "jsonrpc": "2.0",
                "id": req.id,
                "result": {"tools": tool_definitions()}
            }),
            "tools/call" => {
                let tool_name = req.params["name"].as_str().unwrap_or("");
                let arguments = &req.params["arguments"];
                match call_tool(&mut state, tool_name, arguments).await {
                    Ok(result) => json!({
                        "jsonrpc": "2.0",
                        "id": req.id,
                        "result": {
                            "content": [{"type": "text", "text": serde_json::to_string_pretty(&result).unwrap_or_default()}]
                        }
                    }),
                    Err(e) => json!({
                        "jsonrpc": "2.0",
                        "id": req.id,
                        "result": {
                            "content": [{"type": "text", "text": format!("Error: {e}")}],
                            "isError": true
                        }
                    }),
                }
            }
            _ => json!({
                "jsonrpc": "2.0",
                "id": req.id,
                "error": {"code": -32601, "message": format!("Unknown method: {}", req.method)}
            }),
        };

        use std::io::Write;
        let out = serde_json::to_string(&response).unwrap();
        let mut lock = stdout.lock();
        let _ = writeln!(lock, "{out}");
        let _ = lock.flush();
    }
}
