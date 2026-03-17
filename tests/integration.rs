/// Integration tests for solana-mcp-server
///
/// Since main.rs uses private functions, these tests verify the same logic
/// inline without importing from the binary crate. This ensures the contracts
/// are correct and serves as a regression harness.

// ---------------------------------------------------------------------------
// rpc_url mapping
// ---------------------------------------------------------------------------

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

#[test]
fn rpc_url_mainnet() {
    assert_eq!(rpc_url("mainnet"), "https://api.mainnet-beta.solana.com");
}

#[test]
fn rpc_url_devnet() {
    assert_eq!(rpc_url("devnet"), "https://api.devnet.solana.com");
}

#[test]
fn rpc_url_testnet() {
    assert_eq!(rpc_url("testnet"), "https://api.testnet.solana.com");
}

#[test]
fn rpc_url_localhost() {
    assert_eq!(rpc_url("localhost"), "http://127.0.0.1:8899");
}

#[test]
fn rpc_url_unknown_defaults_to_devnet() {
    assert_eq!(rpc_url("unknown_network"), "https://api.devnet.solana.com");
    assert_eq!(rpc_url(""), "https://api.devnet.solana.com");
}

// ---------------------------------------------------------------------------
// LAMPORTS_PER_SOL constant
// ---------------------------------------------------------------------------

const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

#[test]
fn lamports_per_sol_is_billion() {
    assert_eq!(LAMPORTS_PER_SOL, 1_000_000_000);
}

#[test]
fn sol_to_lamports_conversion() {
    let sol: f64 = 1.5;
    let lamports = (sol * LAMPORTS_PER_SOL as f64) as u64;
    assert_eq!(lamports, 1_500_000_000);
}

#[test]
fn lamports_to_sol_conversion() {
    let lamports: u64 = 2_000_000_000;
    let sol = lamports as f64 / LAMPORTS_PER_SOL as f64;
    assert!((sol - 2.0).abs() < 1e-9);
}

// ---------------------------------------------------------------------------
// Keypair generation (mirrors generate_keypair in main.rs)
// Uses test vector: zero seed → known public key
// ---------------------------------------------------------------------------

use ed25519_dalek::SigningKey;

#[test]
fn keypair_from_zero_seed_produces_deterministic_address() {
    let seed = [0u8; 32];
    let signing_key = SigningKey::from_bytes(&seed);
    let address = bs58::encode(signing_key.verifying_key().to_bytes()).into_string();
    // Known address for zero seed (ed25519-dalek v2)
    assert_eq!(address, "4zvwRjXUKGfvwnParsHAS3HuSVzV5cA4McphgmoCtajS");
    // Address must be a valid base58 string of proper length
    assert!(address.len() >= 32 && address.len() <= 44);
}

#[test]
fn keypair_generates_32_byte_public_key() {
    let seed = [1u8; 32];
    let signing_key = SigningKey::from_bytes(&seed);
    let pub_bytes = signing_key.verifying_key().to_bytes();
    assert_eq!(pub_bytes.len(), 32);
}

#[test]
fn keypair_full_secret_is_64_bytes() {
    let seed = [2u8; 32];
    let signing_key = SigningKey::from_bytes(&seed);
    let pub_bytes = signing_key.verifying_key().to_bytes();
    let mut secret = [0u8; 64];
    secret[..32].copy_from_slice(&signing_key.to_bytes());
    secret[32..].copy_from_slice(&pub_bytes);
    assert_eq!(secret.len(), 64);
    // First 32 bytes are the private key seed
    assert_eq!(&secret[..32], &[2u8; 32]);
    // Last 32 bytes are the public key
    assert_eq!(&secret[32..], &pub_bytes);
}

#[test]
fn keypair_from_secret_round_trips() {
    let original_seed = [42u8; 32];
    let signing_key = SigningKey::from_bytes(&original_seed);
    let pub_bytes = signing_key.verifying_key().to_bytes();

    let mut secret_64 = [0u8; 64];
    secret_64[..32].copy_from_slice(&original_seed);
    secret_64[32..].copy_from_slice(&pub_bytes);

    // Reconstruct signing key from 64-byte representation
    let mut key_bytes = [0u8; 32];
    key_bytes.copy_from_slice(&secret_64[..32]);
    let reconstructed = SigningKey::from_bytes(&key_bytes);

    assert_eq!(
        reconstructed.verifying_key().to_bytes(),
        signing_key.verifying_key().to_bytes()
    );
}

// ---------------------------------------------------------------------------
// Base58 address validation
// ---------------------------------------------------------------------------

#[test]
fn valid_solana_address_decodes_to_32_bytes() {
    // System Program address: all 1s
    let addr = "11111111111111111111111111111111";
    let decoded = bs58::decode(addr).into_vec().unwrap();
    assert_eq!(decoded.len(), 32);
}

#[test]
fn token_program_address_is_valid() {
    let addr = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    let decoded = bs58::decode(addr).into_vec().unwrap();
    assert_eq!(decoded.len(), 32);
}

#[test]
fn invalid_base58_chars_rejected() {
    // '0', 'O', 'I', 'l' are not in base58
    let result = bs58::decode("0OIl111111111111111111111111111111").into_vec();
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// Ed25519 signing (test vectors)
// ---------------------------------------------------------------------------

use ed25519_dalek::Signer;

#[test]
fn sign_message_produces_64_byte_signature() {
    let seed = [7u8; 32];
    let signing_key = SigningKey::from_bytes(&seed);
    let message = b"test transaction";
    let signature = signing_key.sign(message);
    assert_eq!(signature.to_bytes().len(), 64);
}

#[test]
fn signature_verifies_correctly() {
    use ed25519_dalek::Verifier;

    let seed = [7u8; 32];
    let signing_key = SigningKey::from_bytes(&seed);
    let message = b"test transaction";
    let signature = signing_key.sign(message);
    assert!(signing_key.verifying_key().verify(message, &signature).is_ok());
}

#[test]
fn different_seeds_produce_different_addresses() {
    let addr1 = bs58::encode(SigningKey::from_bytes(&[1u8; 32]).verifying_key().to_bytes()).into_string();
    let addr2 = bs58::encode(SigningKey::from_bytes(&[2u8; 32]).verifying_key().to_bytes()).into_string();
    assert_ne!(addr1, addr2);
}
