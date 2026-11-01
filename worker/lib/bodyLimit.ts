export class BodySizeLimitError extends Error {
  constructor(maxBytes: number) {
    super(`Body exceeds the ${maxBytes}-byte limit`);
    this.name = "BodySizeLimitError";
  }
}

export type BoundedBody =
  { exceeded: true; bytes: null } | { exceeded: false; bytes: Uint8Array };

/** Return true only for a syntactically valid Content-Length above the cap. */
export function declaredLengthExceedsLimit(
  value: string | null,
  maxBytes: number,
): boolean {
  if (value === null) return false;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return false;
  return BigInt(normalized) > BigInt(maxBytes);
}

/** Request cancellation without waiting for another branch of a tee'd stream. */
export function cancelStream(
  stream: ReadableStream<Uint8Array> | null,
  reason?: unknown,
): void {
  if (!stream) return;
  void stream.cancel(reason).catch(() => undefined);
}

/**
 * Read at most maxBytes from a stream. If the cap is crossed, discard the
 * partial result and cancel the source immediately. Memory use is bounded by
 * the configured limit plus one source chunk.
 */
export async function readStreamWithLimit(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<BoundedBody> {
  if (!stream) return { exceeded: false, bytes: new Uint8Array() };

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });

  try {
    if (signal?.aborted) {
      abort();
      throw new Error("Body read aborted");
    }

    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new Error("Body read aborted");
      if (done) break;
      if (!value) continue;

      if (value.byteLength > maxBytes - total) {
        void reader
          .cancel(new BodySizeLimitError(maxBytes))
          .catch(() => undefined);
        return { exceeded: true, bytes: null };
      }

      chunks.push(value);
      total += value.byteLength;
    }

    if (chunks.length === 1 && chunks[0].byteLength === total) {
      return { exceeded: false, bytes: chunks[0] };
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { exceeded: false, bytes };
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

/**
 * Forward a stream without buffering it, erroring and cancelling its source as
 * soon as more than maxBytes have been observed.
 */
export function limitStreamBytes(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  onExceeded?: () => void,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let total = 0;
  let finished = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;

      try {
        const { done, value } = await reader.read();
        if (finished) return;
        if (done) {
          finished = true;
          controller.close();
          return;
        }
        if (!value) return;

        if (value.byteLength > maxBytes - total) {
          finished = true;
          onExceeded?.();
          const error = new BodySizeLimitError(maxBytes);
          void reader.cancel(error).catch(() => undefined);
          controller.error(error);
          return;
        }

        total += value.byteLength;
        controller.enqueue(value);
      } catch (error) {
        if (!finished) {
          finished = true;
          controller.error(error);
        }
      }
    },

    cancel(reason) {
      finished = true;
      return reader.cancel(reason).catch(() => undefined);
    },
  });
}
