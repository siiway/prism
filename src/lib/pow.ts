// Proof-of-work solver. Spawns N Web Workers (one per logical core) to
// search the nonce space in parallel — worker k of N tries nonces
// k, k+N, k+2N, … . The first worker to find a solution wins; the rest
// are terminated immediately (worker.terminate() kills them mid-loop, so
// we don't need a cooperative cancellation protocol).
//
// Each worker prefers the WASM solver (Rust + sha2 crate, with SHA-256
// midstate caching via Sha256::clone()). If WASM fails to compile or run,
// it falls back to a synchronous JS SHA-256 implementation embedded
// inline. The JS fallback is much faster than awaiting SubtleCrypto per
// iteration because there's no async microtask round-trip per nonce.

const MAX_WORKERS = 8;

const WORKER_SCRIPT = `
${syncSha256Source()}

let wasm = null;

async function ensureWasm(buf) {
  if (wasm) return true;
  try {
    const mod = await WebAssembly.instantiate(buf, {});
    wasm = mod.instance.exports;
    return true;
  } catch {
    return false;
  }
}

function leadingZerosOk(hash, difficulty) {
  let remaining = difficulty;
  for (let i = 0; i < hash.length; i++) {
    if (remaining >= 8) {
      if (hash[i] !== 0) return false;
      remaining -= 8;
      if (remaining === 0) return true;
    } else {
      if (remaining === 0) return true;
      const mask = 0xff << (8 - remaining);
      return (hash[i] & mask) === 0;
    }
  }
  return true;
}

function solveWithWasm(challenge, difficulty, start, stride) {
  const enc = new TextEncoder().encode(challenge);
  const ptr = wasm.alloc(enc.length);
  const mem = new Uint8Array(wasm.memory.buffer);
  mem.set(enc, ptr);
  const result = wasm.solve(ptr, enc.length, difficulty, BigInt(start), stride);
  wasm.dealloc(ptr, enc.length);
  const n = typeof result === 'bigint' ? Number(result) : result;
  return n < 0 ? null : n;
}

function solveWithJs(challenge, difficulty, start, stride) {
  const enc = new TextEncoder().encode(challenge);
  const ctx = sha256ContextForPrefix(enc);
  const tailNonceBuf = new Uint8Array(4);
  const tailView = new DataView(tailNonceBuf.buffer);

  let nonce = start >>> 0;
  while (true) {
    tailView.setUint32(0, nonce, false);
    const hash = sha256ContextDigestWithTail(ctx, enc.length, tailNonceBuf);
    if (leadingZerosOk(hash, difficulty)) return nonce;
    const next = (nonce + stride) >>> 0;
    if (next < nonce) return null; // wrapped past u32 max
    nonce = next;
  }
}

let wasmBuf = null;
self.onmessage = async (e) => {
  if (e.data.wasm) { wasmBuf = e.data.wasm; return; }
  const { challenge, difficulty, start, stride } = e.data;
  let solved = null;
  if (wasmBuf && await ensureWasm(wasmBuf)) {
    solved = solveWithWasm(challenge, difficulty, start, stride);
  } else {
    solved = solveWithJs(challenge, difficulty, start, stride);
  }
  if (solved === null) self.postMessage({ exhausted: true });
  else self.postMessage({ nonce: solved });
};
`;

/** Synchronous SHA-256 with a "context for prefix" so the constant
 *  challenge can be hashed once and reused per nonce. */
function syncSha256Source(): string {
  return `
const K32 = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
]);
const W = new Uint32Array(64);
function rotr(x,n){ return (x>>>n)|(x<<(32-n)); }
function compressBlock(state, block, off) {
  for (let i=0;i<16;i++) W[i] = ((block[off+i*4]<<24) | (block[off+i*4+1]<<16) | (block[off+i*4+2]<<8) | block[off+i*4+3]) >>> 0;
  for (let i=16;i<64;i++) {
    const s0 = rotr(W[i-15],7) ^ rotr(W[i-15],18) ^ (W[i-15]>>>3);
    const s1 = rotr(W[i-2],17) ^ rotr(W[i-2],19) ^ (W[i-2]>>>10);
    W[i] = (W[i-16] + s0 + W[i-7] + s1) | 0;
  }
  let a=state[0],b=state[1],c=state[2],d=state[3],e=state[4],f=state[5],g=state[6],h=state[7];
  for (let i=0;i<64;i++) {
    const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
    const ch = (e&f) ^ ((~e)&g);
    const t1 = (h + S1 + ch + K32[i] + W[i]) | 0;
    const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
    const mj = (a&b) ^ (a&c) ^ (b&c);
    const t2 = (S0 + mj) | 0;
    h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
  }
  state[0]=(state[0]+a)|0; state[1]=(state[1]+b)|0; state[2]=(state[2]+c)|0; state[3]=(state[3]+d)|0;
  state[4]=(state[4]+e)|0; state[5]=(state[5]+f)|0; state[6]=(state[6]+g)|0; state[7]=(state[7]+h)|0;
}
function sha256ContextForPrefix(prefix) {
  // Process all FULL blocks of the prefix; keep the trailing partial in
  // 'tail' so finalize can append nonce + padding.
  const state = new Uint32Array([
    0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
    0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19
  ]);
  let off = 0;
  while (off + 64 <= prefix.length) {
    compressBlock(state, prefix, off);
    off += 64;
  }
  return { state, tail: prefix.subarray(off), prefixLen: prefix.length };
}
const finalBlockBuf = new Uint8Array(128);
function sha256ContextDigestWithTail(ctx, prefixLen, nonceBytes) {
  const totalBytes = prefixLen + nonceBytes.length;
  const totalBits = totalBytes * 8;
  const state = new Uint32Array(ctx.state);
  // Trailing portion = (tail bytes from prefix) + nonce + 0x80 + zero pad
  // + 8-byte length, rounded up to a 64-byte boundary. For typical
  // challenge lengths this is exactly 64 bytes (one block).
  const payloadLen = ctx.tail.length + nonceBytes.length;
  const padTo = (payloadLen + 1 + 8 + 63) & ~63;
  for (let i = 0; i < padTo; i++) finalBlockBuf[i] = 0;
  finalBlockBuf.set(ctx.tail, 0);
  finalBlockBuf.set(nonceBytes, ctx.tail.length);
  finalBlockBuf[payloadLen] = 0x80;
  const hi = Math.floor(totalBits / 0x100000000);
  const lo = totalBits >>> 0;
  finalBlockBuf[padTo - 8] = (hi >>> 24) & 0xff;
  finalBlockBuf[padTo - 7] = (hi >>> 16) & 0xff;
  finalBlockBuf[padTo - 6] = (hi >>> 8) & 0xff;
  finalBlockBuf[padTo - 5] = hi & 0xff;
  finalBlockBuf[padTo - 4] = (lo >>> 24) & 0xff;
  finalBlockBuf[padTo - 3] = (lo >>> 16) & 0xff;
  finalBlockBuf[padTo - 2] = (lo >>> 8) & 0xff;
  finalBlockBuf[padTo - 1] = lo & 0xff;
  for (let off = 0; off < padTo; off += 64) {
    compressBlock(state, finalBlockBuf, off);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i*4]   = (state[i] >>> 24) & 0xff;
    out[i*4+1] = (state[i] >>> 16) & 0xff;
    out[i*4+2] = (state[i] >>> 8)  & 0xff;
    out[i*4+3] = state[i] & 0xff;
  }
  return out;
}
`;
}

interface SolveOptions {
  /** Cancel the search; rejects with an AbortError. */
  signal?: AbortSignal;
}

export async function solvePoW(
  challenge: string,
  difficulty: number,
  options: SolveOptions = {},
): Promise<number> {
  const wasmBuf = await tryLoadWasm();
  const cores = Math.min(MAX_WORKERS, navigator.hardwareConcurrency || 4);
  const stride = cores;

  return new Promise<number>((resolve, reject) => {
    const blob = new Blob([WORKER_SCRIPT], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const workers: Worker[] = [];
    let settled = false;

    const cleanup = () => {
      for (const w of workers) w.terminate();
      URL.revokeObjectURL(url);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    if (options.signal) {
      if (options.signal.aborted) {
        URL.revokeObjectURL(url);
        return reject(new DOMException("Aborted", "AbortError"));
      }
      options.signal.addEventListener("abort", () =>
        finish(() => reject(new DOMException("Aborted", "AbortError"))),
      );
    }

    let exhaustedCount = 0;
    for (let k = 0; k < cores; k++) {
      const worker = new Worker(url);
      workers.push(worker);
      worker.onmessage = (
        e: MessageEvent<{ nonce?: number; exhausted?: boolean }>,
      ) => {
        if (typeof e.data.nonce === "number") {
          finish(() => resolve(e.data.nonce!));
        } else if (e.data.exhausted) {
          exhaustedCount++;
          if (exhaustedCount >= cores) {
            finish(() => reject(new Error("PoW search exhausted")));
          }
        }
      };
      worker.onerror = (err) => {
        finish(() => reject(err));
      };
      if (wasmBuf) {
        // Slice a fresh buffer per worker; the underlying ArrayBuffer can
        // only be transferred once, and we're keeping it cached in the
        // outer scope for next time.
        worker.postMessage({ wasm: wasmBuf.slice(0) });
      }
      worker.postMessage({ challenge, difficulty, start: k, stride });
    }
  });
}

let cachedWasm: ArrayBuffer | null | undefined;
async function tryLoadWasm(): Promise<ArrayBuffer | null> {
  if (cachedWasm !== undefined) return cachedWasm;
  try {
    const res = await fetch("/pow.wasm");
    if (!res.ok) {
      cachedWasm = null;
      return null;
    }
    cachedWasm = await res.arrayBuffer();
    return cachedWasm;
  } catch {
    cachedWasm = null;
    return null;
  }
}
