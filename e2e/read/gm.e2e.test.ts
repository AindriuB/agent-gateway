import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatProblems, COMPENDIUM, searchProblems, type ChatMsg } from '../lib/expect.js';
import { blindMessageId, loadContext, readAllPages, requireUuids } from '../lib/context.js';
import { openUserSession, type UserSession } from '../lib/session.js';
import { FIXTURE } from '../fixtures/spec.js';

const ctx = loadContext();
let session: UserSession;

beforeAll(async () => {
  session = await openUserSession(ctx.config, ctx.paths, ctx.config.gmUser);
});

afterAll(async () => {
  await session?.close();
});

const gw = () => session.gateway;

describe('GM reads', () => {
  it('document_search lists every fixture entry', async () => {
    const r = await gw().call('document_search', {
      type: 'JournalEntry',
      query: 'ag-test',
      limit: 50,
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.structured?.truncated, 'search was truncated').toBe(false);
    const names = ((r.structured?.results ?? []) as Array<{ name: string }>).map((x) => x.name);
    expect(searchProblems('gm', names)).toEqual([]);
  });

  it('document_get returns hidden and limited entries', async () => {
    for (const key of ['hidden', 'limited']) {
      const uuid = requireUuids(ctx)[key];
      const r = await gw().call('document_get', { uuid });
      expect(r.isError, r.text).toBe(false);
    }
  });

  it('ag-test-public includes the gm page and every secret', async () => {
    const uuid = requireUuids(ctx).public;
    const content = await readAllPages(
      (extra) => gw().call('document_get', { uuid, ...extra }),
      'content',
    );
    const { text } = FIXTURE;
    for (const s of [text.gmPage, text.publicPageSecret, text.markdownSecret]) {
      expect(content).toContain(s);
    }
  });

  it('the active scene includes the placeables', async () => {
    const uuid = requireUuids(ctx).activeScene;
    const content = await readAllPages(
      (extra) => gw().call('document_get', { uuid, ...extra }),
      'content',
    );
    for (const s of Object.values(FIXTURE.placeables)) expect(content).toContain(s);
  });

  it('chat_read shows every fixture message, the GM whisper and the blind roll', async () => {
    const msgs: ChatMsg[] = [];
    let before: string | undefined;
    for (let page = 0; page < 5; page++) {
      const r = await gw().call('chat_read', { limit: 100, ...(before ? { before } : {}) });
      expect(r.isError, r.text).toBe(false);
      for (const m of (r.structured?.messages ?? []) as ChatMsg[]) msgs.push(m);
      before = r.structured?.nextBefore as string | undefined;
      if (!before) break;
    }
    expect(chatProblems('gm', msgs, blindMessageId(ctx))).toEqual([]);
  });

  it('compendium: the LIMITED pack is searchable and the observable packs return results', async () => {
    for (const pack of [COMPENDIUM.limitedPack, ...COMPENDIUM.observablePacks]) {
      const r = await gw().call('compendium_search', { query: 'a', pack, limit: 50 });
      expect(r.isError, r.text).toBe(false);
      expect(((r.structured?.results ?? []) as unknown[]).length, pack).toBeGreaterThan(0);
    }
  });
});
