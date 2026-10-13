const HEAD_BYTES = 512;

export class LineTooLongError extends Error {
  constructor(readonly limit: number) {
    super(`line over ${limit} bytes`);
  }
}

/**
 * Splits a byte stream into newline-delimited lines, enforcing a size limit while reading, before
 * any JSON.parse. On overflow it throws once and then discards input up to the next newline.
 */
export class LineSplitter {
  private parts: Buffer[] = [];
  private len = 0;
  private skipping = false;
  private head = '';
  /** First bytes of the most recent line dropped for size, so a caller can find its request id. */
  droppedHead = '';
  constructor(private maxBytes: number) {}

  /** Raise or lower the limit for lines that have not started yet (after the handshake line). */
  setLimit(maxBytes: number): void {
    this.maxBytes = maxBytes;
  }

  /** Complete lines in `chunk`. Throws LineTooLongError after dropping the oversized line. */
  push(chunk: Buffer): string[] {
    const out: string[] = [];
    let start = 0;
    let overflow = false;
    for (;;) {
      const i = chunk.indexOf(10, start);
      if (i < 0) break;
      if (this.len === 0 && !this.skipping)
        this.head = chunk.subarray(start, Math.min(i, start + HEAD_BYTES)).toString('utf8');
      if (this.skipping) {
        this.skipping = false;
      } else if (this.len + (i - start) > this.maxBytes) {
        overflow = true;
        this.droppedHead = this.head;
        this.parts = [];
        this.len = 0;
      } else {
        this.parts.push(chunk.subarray(start, i));
        out.push(Buffer.concat(this.parts).toString('utf8'));
        this.parts = [];
        this.len = 0;
      }
      start = i + 1;
    }
    if (!this.skipping) {
      const rest = chunk.length - start;
      if (this.len === 0 && rest > 0)
        this.head = chunk.subarray(start, start + HEAD_BYTES).toString('utf8');
      if (this.len + rest > this.maxBytes) {
        overflow = true;
        this.droppedHead = this.head;
        this.parts = [];
        this.len = 0;
        this.skipping = true;
      } else if (rest > 0) {
        this.parts.push(chunk.subarray(start));
        this.len += rest;
      }
    }
    if (overflow) throw new LineTooLongError(this.maxBytes);
    return out;
  }
}
