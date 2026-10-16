/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { imageUpload } from '@agent-gateway/protocol';
import { describe, expect, it } from 'vitest';
import { decodeBase64Strict, redactedArgs, sha256Bytes } from '../../src/ops/redact.js';

describe('sha256Bytes', () => {
  it('matches the known vector for abc', () =>
    expect(sha256Bytes(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    ));
  it.each([0, 1, 55, 56, 63, 64, 65, 1000, 70000])('agrees with node for %i bytes', (n) => {
    const b = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 255);
    expect(sha256Bytes(b)).toBe(createHash('sha256').update(b).digest('hex'));
  });
});

describe('redactedArgs', () => {
  it('replaces a declared field by size and the hash of the decoded bytes, not of the text', () => {
    const args = { data: 'YWJj', mime: 'image/png' };
    const out = redactedArgs(imageUpload, args) as Record<string, any>;
    expect(out.mime).toBe('image/png');
    expect(out.data).toEqual({
      redacted: true,
      bytes: 3,
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    });
    expect(out.data.sha256).not.toBe(createHash('sha256').update('YWJj').digest('hex'));
    expect(args.data).toBe('YWJj');
  });
  it('never includes text of a field that is not valid base64', () => {
    const out = redactedArgs(imageUpload, { data: 'not base64!!', mime: 'image/png' }) as any;
    expect(out.data).toEqual({ redacted: true, chars: 12 });
    expect(JSON.stringify(out)).not.toContain('not base64');
  });
  it('returns the same reference when nothing is declared or present', () => {
    const args = { data: 'YWJj' };
    expect(redactedArgs({}, args)).toBe(args);
    expect(redactedArgs(undefined, args)).toBe(args);
    const noField = { mime: 'image/png' };
    expect(redactedArgs(imageUpload, noField)).toBe(noField);
    expect(redactedArgs(imageUpload, 'text')).toBe('text');
  });
  it('decodes strictly', () => {
    expect(decodeBase64Strict('YWJj')).toEqual(new TextEncoder().encode('abc'));
    for (const bad of ['', 'YWJ', 'YW Jj', 'YWJj=', '=YWJ'])
      expect(decodeBase64Strict(bad)).toBeNull();
  });
});

describe('registry', () => {
  it('carries redactArgs for core tools and ignores it on pack tools', async () => {
    const { ToolRegistry } = await import('../../src/ops/registry-class.js');
    const { coreEntry } = await import('../../src/ops/core-tools.js');
    const registry = new ToolRegistry();
    const core = coreEntry(imageUpload, async () => ({ text: '', structured: {} }));
    const pack = {
      ...core,
      name: 'pk-upload',
      origin: { packId: 'pk', version: '1.0.0', prefix: 'pk' },
    };
    registry.registerAll([core, pack]);
    expect(registry.info('image_upload')?.redactArgs).toEqual(['data']);
    const args = { data: 'YWJj' };
    expect(redactedArgs(registry.info('pk-upload'), args)).toBe(args);
  });
});
