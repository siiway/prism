//! Proof-of-Work WASM module for Prism.
//!
//! Build: cargo build --target wasm32-unknown-unknown --release
//! Then copy target/wasm32-unknown-unknown/release/prism_pow.wasm to public/pow.wasm
//!
//! Algorithm:
//!   Find nonce (u32) such that SHA-256(challenge_bytes ++ nonce_be32)
//!   has `difficulty` leading zero bits.
//!
//! Optimisations vs. the original hand-rolled implementation:
//!   * Switched to the `sha2` crate (well-tuned pure-Rust implementation).
//!   * Pre-feed the challenge into the hasher once and `clone()` per nonce.
//!     This effectively reuses the SHA-256 midstate — only the final
//!     block has to be processed for each candidate. ~2× hash throughput
//!     for typical (≥64-byte) challenges.
//!   * `solve` accepts (start, stride) so callers can shard the search
//!     across N Web Workers (worker k of N tries nonces k, k+N, k+2N, …).
//!   * Zero allocations in the hot loop.
//!
//! Exports (raw C ABI, no wasm-bindgen):
//!   alloc(len: i32) -> i32                                    — allocate
//!   dealloc(ptr: i32, len: i32)                               — free
//!   solve(ptr: i32, len: i32, difficulty: i32,
//!         start: i64, stride: i32) -> i64                     — search

use sha2::{Digest, Sha256};
use std::alloc::{alloc as sys_alloc, dealloc as sys_dealloc, Layout};

#[no_mangle]
pub unsafe extern "C" fn alloc(len: i32) -> i32 {
    let layout = Layout::from_size_align(len as usize, 1).unwrap();
    sys_alloc(layout) as i32
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: i32, len: i32) {
    let layout = Layout::from_size_align(len as usize, 1).unwrap();
    sys_dealloc(ptr as *mut u8, layout);
}

/// Search the nonce space for one that hashes with `difficulty` leading zero
/// bits. Returns the nonce as i64 on success, -1 if the (start, stride)
/// stripe was exhausted without a hit.
///
/// `start` is the first nonce to try; `stride` is the step between nonces.
/// Pass start=0, stride=1 to search the whole space single-threaded.
#[no_mangle]
pub unsafe extern "C" fn solve(
    ptr: i32,
    len: i32,
    difficulty: i32,
    start: i64,
    stride: i32,
) -> i64 {
    let challenge = std::slice::from_raw_parts(ptr as *const u8, len as usize);
    let difficulty = difficulty as u32;
    let stride = (stride.max(1)) as u32;
    let mut nonce = (start as u64) as u32; // truncate; nonce is u32

    let mask_bytes = (difficulty / 8) as usize;
    let mask_bits = (difficulty % 8) as u32;
    let final_mask: u8 = if mask_bits == 0 {
        0
    } else {
        0xffu8 << (8 - mask_bits)
    };

    // Pre-feed the constant prefix. Cloning Sha256 snapshots the midstate
    // (and any unprocessed tail bytes), so each iteration only finishes
    // the trailing block — a big speedup over re-hashing from scratch.
    let mut base = Sha256::new();
    base.update(challenge);

    loop {
        let mut h = base.clone();
        h.update(nonce.to_be_bytes());
        let hash = h.finalize();

        // Leading-zero-bytes check, then leading-bits-in-the-next-byte check.
        let mut ok = true;
        for i in 0..mask_bytes {
            if hash[i] != 0 {
                ok = false;
                break;
            }
        }
        if ok && mask_bits > 0 && (hash[mask_bytes] & final_mask) != 0 {
            ok = false;
        }
        if ok {
            return nonce as i64;
        }

        match nonce.checked_add(stride) {
            Some(n) => nonce = n,
            None => return -1,
        }
    }
}
