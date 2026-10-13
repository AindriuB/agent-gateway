import { afterEach, describe, expect, it } from 'vitest';
import { LinkListenError, mapListenError } from '../../src/link/server.js';
import { startServer, type Harness } from './helpers.js';

const open: Harness[] = [];
afterEach(async () => {
  for (const h of open.splice(0)) {
    await h.server.close();
    h.store.close();
  }
});

describe('LinkServer.listen errors', () => {
  it('rejects with LinkListenError when the port is in use', async () => {
    const first = await startServer();
    open.push(first);
    const err = await startServer({ port: first.port }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LinkListenError);
    const e = err as LinkListenError;
    expect(e.code).toBe('EADDRINUSE');
    expect(e.port).toBe(first.port);
    expect(e.message).toBe(`link port ${first.port} is in use; is another gateway running?`);
  });

  it('maps EACCES', () => {
    const raw = Object.assign(new Error('listen EACCES'), { code: 'EACCES' });
    const e = mapListenError(raw, 80) as LinkListenError;
    expect(e).toBeInstanceOf(LinkListenError);
    expect(e.code).toBe('EACCES');
    expect(e.port).toBe(80);
    expect(e.message).toBe('permission denied binding link port 80');
  });

  it('passes other codes through unchanged', () => {
    const raw = Object.assign(new Error('nope'), { code: 'EADDRNOTAVAIL' });
    expect(mapListenError(raw, 80)).toBe(raw);
  });
});
