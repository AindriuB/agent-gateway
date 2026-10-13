export class LineTooLongError extends Error {
  constructor(readonly limit: number) {
    super(`line over ${limit} bytes`);
  }
}

const MAX_ID_CHARS = 200;

/**
 * Finds the top-level `"id"` of a JSON-RPC object while its bytes stream past, in constant
 * memory: it tracks nesting depth and string/escape state, and captures only the value of the key
 * `id` at depth 1 (a number, or a string up to 200 characters), wherever it appears in the object.
 */
export class TopLevelIdScanner {
  private depth = 0;
  private inStr = false;
  private esc = false;
  private role: 'key' | 'value' | 'other' = 'other';
  private buf = '';
  private bad = false;
  private expectKey = false;
  private idKey = false;
  private wantValue = false;
  private num = false;
  private found: string | undefined;

  reset(): void {
    this.depth = 0;
    this.inStr = false;
    this.esc = false;
    this.role = 'other';
    this.buf = '';
    this.bad = false;
    this.expectKey = false;
    this.idKey = false;
    this.wantValue = false;
    this.num = false;
    this.found = undefined;
  }

  feed(bytes: Uint8Array): void {
    for (const c of bytes) this.byte(c);
  }

  /** The id as a JSON value (number or string), if one was found at the top level. */
  result(): string | number | undefined {
    if (this.num) this.endNumber();
    if (this.found === undefined) return undefined;
    try {
      const v: unknown = JSON.parse(this.found);
      return typeof v === 'string' || typeof v === 'number' ? v : undefined;
    } catch {
      return undefined;
    }
  }

  private add(c: number): void {
    if (this.buf.length >= MAX_ID_CHARS || c > 0x7e) this.bad = true;
    else this.buf += String.fromCharCode(c);
  }

  private endNumber(): void {
    this.num = false;
    this.wantValue = false;
    if (!this.bad && this.found === undefined) this.found = this.buf;
  }

  private byte(c: number): void {
    if (this.inStr) {
      if (this.esc) {
        this.esc = false;
        if (this.role !== 'other') this.add(c);
      } else if (c === 0x5c) {
        this.esc = true;
        if (this.role === 'value') this.add(c);
        else if (this.role === 'key') this.bad = true;
      } else if (c === 0x22) {
        this.inStr = false;
        if (this.role === 'key') {
          this.idKey = !this.bad && this.buf === 'id';
          this.expectKey = false;
        } else if (this.role === 'value') {
          if (!this.bad && this.found === undefined) this.found = `"${this.buf}"`;
          this.wantValue = false;
        }
      } else if (this.role !== 'other') {
        this.add(c);
      }
      return;
    }
    if (this.num) {
      // digits, sign, exponent and fraction characters continue a number
      if (
        (c >= 0x30 && c <= 0x39) ||
        c === 0x2d ||
        c === 0x2b ||
        c === 0x2e ||
        c === 0x65 ||
        c === 0x45
      ) {
        this.add(c);
        return;
      }
      this.endNumber();
    }
    switch (c) {
      case 0x22: // "
        this.inStr = true;
        this.buf = '';
        this.bad = false;
        if (this.depth === 1 && this.expectKey) this.role = 'key';
        else if (this.depth === 1 && this.wantValue) this.role = 'value';
        else this.role = 'other';
        break;
      case 0x7b: // {
        this.depth++;
        if (this.depth === 1) {
          this.expectKey = true;
          this.idKey = false;
          this.wantValue = false;
        }
        break;
      case 0x5b: // [
        this.depth++;
        break;
      case 0x7d: // }
      case 0x5d: // ]
        this.depth--;
        break;
      case 0x2c: // ,
        if (this.depth === 1) {
          this.expectKey = true;
          this.idKey = false;
          this.wantValue = false;
        }
        break;
      case 0x3a: // :
        if (this.depth === 1) this.wantValue = this.idKey;
        break;
      default:
        if (this.depth === 1 && this.wantValue && (c === 0x2d || (c >= 0x30 && c <= 0x39))) {
          this.num = true;
          this.buf = String.fromCharCode(c);
          this.bad = false;
        }
    }
  }
}

/**
 * Splits a byte stream into newline-delimited lines, enforcing a size limit while reading, before
 * any JSON.parse.
 *
 * By default an oversized line makes `push` throw once; the rest of that line is discarded. With
 * `trackIds` it never throws: oversized lines are skipped in constant memory while their top-level
 * JSON-RPC id is scanned, and each is recorded in `overflows` when its line ends (the id may come
 * last), with `undefined` when no id could be found.
 */
export class LineSplitter {
  private parts: Buffer[] = [];
  private len = 0;
  private oversized = false;
  private readonly scan: TopLevelIdScanner | undefined;
  readonly overflows: (string | number | undefined)[] = [];

  constructor(
    private maxBytes: number,
    trackIds = false,
  ) {
    this.scan = trackIds ? new TopLevelIdScanner() : undefined;
  }

  /** Raise or lower the limit for lines that have not started yet (after the handshake line). */
  setLimit(maxBytes: number): void {
    this.maxBytes = maxBytes;
  }

  push(chunk: Buffer): string[] {
    const out: string[] = [];
    let start = 0;
    let overflow = false;
    for (;;) {
      const i = chunk.indexOf(10, start);
      const piece = chunk.subarray(start, i < 0 ? chunk.length : i);
      this.scan?.feed(piece);
      if (!this.oversized) {
        if (this.len + piece.length > this.maxBytes) {
          this.parts = [];
          this.len = 0;
          this.oversized = true;
          if (!this.scan) overflow = true;
        } else if (piece.length > 0) {
          this.parts.push(piece);
          this.len += piece.length;
        }
      }
      if (i < 0) break;
      if (this.oversized) {
        if (this.scan) this.overflows.push(this.scan.result());
        this.oversized = false;
      } else {
        out.push(Buffer.concat(this.parts).toString('utf8'));
        this.parts = [];
        this.len = 0;
      }
      this.scan?.reset();
      start = i + 1;
    }
    if (overflow) throw new LineTooLongError(this.maxBytes);
    return out;
  }
}
