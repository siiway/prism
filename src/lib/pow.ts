// Proof-of-Work solver using Web Workers + SubtleCrypto
// Falls back to WASM if public/pow.wasm is available.

const WORKER_SCRIPT = `
self.onmessage = async (e) => {
  const { challenge, difficulty } = e.data;
  const enc = new TextEncoder();

  for (let nonce = 0; nonce <= 0xffffffff; nonce++) {
    const buf = new ArrayBuffer(challenge.length + 4);
    const view = new DataView(buf);
    const encoded = enc.encode(challenge);
    for (let i = 0; i < encoded.length; i++) new DataView(buf).setUint8(i, encoded[i]);
    view.setUint32(encoded.length, nonce, false);

    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));

    let remaining = difficulty;
    let ok = true;
    for (const byte of hash) {
      if (remaining >= 8) {
        if (byte !== 0) { ok = false; break; }
        remaining -= 8;
      } else {
        const mask = 0xff << (8 - remaining);
        if ((byte & mask) !== 0) ok = false;
        break;
      }
    }

    if (ok) {
      self.postMessage({ nonce });
      return;
    }

    // Yield periodically to stay responsive
    if (nonce % 10000 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  self.postMessage({ error: 'No solution found' });
};
`;

export async function solvePoW(
  challenge: string,
  difficulty: number,
): Promise<number> {
  // Try loading WASM worker first
  try {
    const wasmRes = await fetch("/pow.wasm");
    if (wasmRes.ok) {
      return solvePoWWasm(challenge, difficulty, await wasmRes.arrayBuffer());
    }
  } catch {
    // fall through to JS worker
  }

  return solvePoWJs(challenge, difficulty);
}

function solvePoWJs(challenge: string, difficulty: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([WORKER_SCRIPT], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    worker.onmessage = (
      e: MessageEvent<{ nonce?: number; error?: string }>,
    ) => {
      worker.terminate();
      URL.revokeObjectURL(url);
      if (e.data.nonce !== undefined) resolve(e.data.nonce);
      else reject(new Error(e.data.error ?? "PoW failed"));
    };

    worker.onerror = (err) => {
      worker.terminate();
      URL.revokeObjectURL(url);
      reject(err);
    };

    worker.postMessage({ challenge, difficulty });
  });
}

const WASM_WORKER_SCRIPT = `
let wasm;

self.onmessage = async (e) => {
  if (e.data.wasm) {
    const module = await WebAssembly.instantiate(e.data.wasm, {});
    wasm = module.instance.exports;
    self.postMessage({ ready: true });
    return;
  }

  const { challenge, difficulty } = e.data;
  const enc = new TextEncoder();
  const encoded = enc.encode(challenge);

  // Allocate memory in WASM
  const ptr = wasm.alloc(encoded.length);
  const mem = new Uint8Array(wasm.memory.buffer);
  mem.set(encoded, ptr);

  const nonce = wasm.solve(ptr, encoded.length, difficulty);
  wasm.dealloc(ptr, encoded.length);

  if (nonce === -1n || nonce === -1) {
    self.postMessage({ error: 'No solution found' });
  } else {
    self.postMessage({ nonce: Number(nonce) });
  }
};
`;

function solvePoWWasm(
  challenge: string,
  difficulty: number,
  wasmBuf: ArrayBuffer,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([WASM_WORKER_SCRIPT], {
      type: "application/javascript",
    });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    worker.onmessage = (
      e: MessageEvent<{ ready?: boolean; nonce?: number; error?: string }>,
    ) => {
      if (e.data.ready) {
        // WASM initialised — now send the challenge
        worker.postMessage({ challenge, difficulty });
      } else if (e.data.nonce !== undefined) {
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve(e.data.nonce);
      } else if (e.data.error) {
        worker.terminate();
        URL.revokeObjectURL(url);
        solvePoWJs(challenge, difficulty).then(resolve).catch(reject);
      }
    };

    worker.onerror = () => {
      worker.terminate();
      URL.revokeObjectURL(url);
      solvePoWJs(challenge, difficulty).then(resolve).catch(reject);
    };

    // Send WASM binary — worker posts { ready: true } when compiled
    worker.postMessage({ wasm: wasmBuf }, [wasmBuf]);
  });
}
