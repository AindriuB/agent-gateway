import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, parseLinkMessage } from '../../src/link/index.js';

const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
const frame = (images: unknown) =>
  JSON.stringify({ type: 'result', id: '1', ok: true, text: 'x', images });

describe('result images', () => {
  it('is protocol 7.1.0', () => expect(PROTOCOL_VERSION).toBe('7.1.0'));
  it('accepts one image', () => {
    expect(parseLinkMessage(frame([{ mimeType: 'image/png', data: png }])).ok).toBe(true);
  });
  it('accepts a result with no images', () => {
    expect(parseLinkMessage('{"type":"result","id":"1","ok":true,"text":"x"}').ok).toBe(true);
  });
  it('rejects image/svg+xml', () => {
    expect(parseLinkMessage(frame([{ mimeType: 'image/svg+xml', data: png }])).ok).toBe(false);
  });
  it('rejects two images', () => {
    const i = { mimeType: 'image/png', data: png };
    expect(parseLinkMessage(frame([i, i])).ok).toBe(false);
  });
  it('rejects data that is not base64', () => {
    for (const data of ['not base64!', 'abc', '', 'data:image/png;base64,AAAA'])
      expect(parseLinkMessage(frame([{ mimeType: 'image/png', data }])).ok).toBe(false);
  });
  it('rejects data over the cap', () => {
    const data = 'A'.repeat(699_056);
    expect(parseLinkMessage(frame([{ mimeType: 'image/png', data }])).ok).toBe(false);
  });
});
