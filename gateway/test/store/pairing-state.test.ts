import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createInvite, redeemInvite } from '../../src/link/invites.js';
import { openStore, type Store } from '../../src/store/index.js';

let store: Store | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});
const open = (): Store => (store = openStore(join(mkdtempSync(join(tmpdir(), 'ag-ps-')), 'g.db')));
const add = (s: Store, id: string, w = 'w1', u = 'u1') =>
  s.createPairing({ id, tokenHash: `h-${id}`, worldId: w, userId: u });

describe('pairingStateFor', () => {
  it('is none with no rows', () => {
    expect(open().pairingStateFor('w1', 'u1')).toBe('none');
  });
  it('is active with an unrevoked row', () => {
    const s = open();
    add(s, 'a');
    expect(s.pairingStateFor('w1', 'u1')).toBe('active');
  });
  it('is revoked when every row is revoked', () => {
    const s = open();
    add(s, 'a');
    add(s, 'b');
    s.revokePairing('a');
    expect(s.pairingStateFor('w1', 'u1')).toBe('active');
    s.revokePairing('b');
    expect(s.pairingStateFor('w1', 'u1')).toBe('revoked');
  });
  it('is active again after revoke-then-redeem', () => {
    const s = open();
    add(s, 'a');
    s.revokePairing('a');
    const { code } = createInvite(s, { worldId: 'w1', userId: 'u1', gm: true }, Date.now());
    const out = redeemInvite(
      s,
      code,
      { worldId: 'w1', userId: 'u1', userName: 'U', origin: 'http://localhost:30000' },
      Date.now(),
    );
    expect(out.ok).toBe(true);
    expect(s.pairingStateFor('w1', 'u1')).toBe('active');
  });
  it('ignores rows for another world or user', () => {
    const s = open();
    add(s, 'a', 'w2', 'u1');
    add(s, 'b', 'w1', 'u2');
    expect(s.pairingStateFor('w1', 'u1')).toBe('none');
  });
});
