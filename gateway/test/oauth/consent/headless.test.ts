import { afterEach, describe, expect, it } from 'vitest';
import { REDIRECT, call } from '../helpers.js';
import { pairModule, reconnectModule, type FakeModule } from '../../routing/harness.js';
import { consentRig, form, openConsent, postConsent, stopRig, type ConsentRig } from './rig.js';

let r: ConsentRig | undefined;
const modules: FakeModule[] = [];
afterEach(async () => {
  modules.splice(0).forEach((m) => m.tc.ws.terminate());
  await stopRig(r);
  r = undefined;
});

const codes = (m: FakeModule) => m.tc.messages.filter((x) => x.type === 'consentCode');
const settle = () => new Promise((x) => setTimeout(x, 50));

const addAgent = (rig: ConsentRig, userId: string, owner: string | null) =>
  rig.h.store.headless.add({
    name: userId,
    foundryUrl: 'http://localhost:30000',
    worldId: 'w1',
    userId,
    ownerUserId: owner,
  });

async function send(rig: ConsentRig, user: string) {
  const page = await openConsent(rig);
  const reply = await postConsent(rig, page, { action: 'send', world: 'w1', user, scope: 'read' });
  return { page, reply };
}

describe('headless agent consent goes to its owner (task 98)', () => {
  it('sends one consentCode to the owner only, naming the agent', async () => {
    r = await consentRig({}, {});
    addAgent(r, 'bot', 'owner');
    const owner = await pairModule(r.h, 'owner');
    const bot = await pairModule(r.h, 'bot', { userName: 'Bot' });
    modules.push(owner, bot);
    await send(r, 'bot');
    const frame = (await owner.tc.next('consentCode')) as { forAgent?: unknown };
    expect(frame.forAgent).toEqual({ userId: 'bot', name: 'Bot' });
    await settle();
    // The one frame was consumed above; no second one arrived.
    expect(codes(owner)).toHaveLength(0);
    expect(codes(bot)).toHaveLength(0);
  });

  it('binds the grant to the agent and its pairing, not the owner', async () => {
    r = await consentRig({}, {});
    addAgent(r, 'bot', 'owner');
    const owner = await pairModule(r.h, 'owner');
    const bot = await pairModule(r.h, 'bot');
    modules.push(owner, bot);
    const { page } = await send(r, 'bot');
    const { code } = (await owner.tc.next('consentCode')) as unknown as { code: string };
    const done = await postConsent(r, page, { action: 'verify', code });
    expect(done.status).toBe(302);
    expect(r.h.store.oauth.listLiveGrants('w1', 'bot')).toHaveLength(1);
    expect(r.h.store.oauth.listLiveGrants('w1', 'owner')).toHaveLength(0);
    const authCode = new URL(done.headers.location as string).searchParams.get('code')!;
    const tok = await call(r.port, 'POST', '/token', {
      body: form({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: REDIRECT,
        code_verifier: page.verifier,
        client_id: page.clientId,
      }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const access = tok.json().access_token as string;
    const principal = r.oauth.authenticate(access);
    expect(principal?.selector).toMatchObject({ worldId: 'w1', userId: 'bot' });
    // Re-pairing the agent ends the grant (decision (e)).
    r.h.store.revokePairingsFor('w1', 'bot');
    expect(r.h.store.oauth.listLiveGrants('w1', 'bot')).toHaveLength(0);
    expect(r.oauth.authenticate(access)).toBeUndefined();
  });

  it('fails the code when the agent pairing is revoked between delivery and entry', async () => {
    r = await consentRig({}, {});
    addAgent(r, 'bot', 'owner');
    const owner = await pairModule(r.h, 'owner');
    const bot = await pairModule(r.h, 'bot');
    modules.push(owner, bot);
    const { page } = await send(r, 'bot');
    const { code } = (await owner.tc.next('consentCode')) as unknown as { code: string };
    r.h.store.revokePairingsFor('w1', 'bot');
    const res = await postConsent(r, page, { action: 'verify', code });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it('delivers no code when the owner pairing is revoked but the connection is still registered', async () => {
    r = await consentRig({}, {});
    addAgent(r, 'bot', 'owner');
    const owner = await pairModule(r.h, 'owner');
    const bot = await pairModule(r.h, 'bot');
    modules.push(owner, bot);
    r.h.store.revokePairingsFor('w1', 'owner'); // the 5 s sweep has not closed the socket yet
    const { page } = await send(r, 'bot');
    await settle();
    expect(codes(owner)).toHaveLength(0);
    const res = await postConsent(r, page, { action: 'verify', code: '00000000' });
    expect(res.status).toBe(400);
  });

  it('fails the code, as a wrong code does, when the owner pairing is revoked after delivery', async () => {
    r = await consentRig({}, {});
    addAgent(r, 'bot', 'owner');
    const owner = await pairModule(r.h, 'owner');
    const bot = await pairModule(r.h, 'bot');
    modules.push(owner, bot);
    const { page } = await send(r, 'bot');
    const { code } = (await owner.tc.next('consentCode')) as unknown as { code: string };
    const wrong = await postConsent(r, page, { action: 'verify', code: '11111111' });
    r.h.store.revokePairingsFor('w1', 'owner');
    const res = await postConsent(r, page, { action: 'verify', code });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
    const norm = (b: string) => b.replaceAll(page.rid, 'RID').replaceAll(page.csrf, 'CSRF');
    expect(norm(res.body)).toBe(norm(wrong.body));
    expect(r.h.store.oauth.listLiveGrants('w1', 'bot')).toHaveLength(0);
  });

  it('delivers no code when the live connection pairing is revoked but a newer pairing is active', async () => {
    r = await consentRig({}, {});
    const alice = await pairModule(r.h, 'alice');
    modules.push(alice);
    r.h.store.createPairing({
      id: 'p-newer',
      tokenHash: 'h-newer',
      worldId: 'w1',
      userId: 'alice',
      userName: 'alice',
      origin: 'http://localhost:30000',
    });
    r.h.store.revokePairing(alice.agentId); // the 5 s sweep has not closed the socket yet
    expect(r.h.store.listPairings().find((x) => x.id === 'p-newer')?.revokedAt).toBeFalsy();
    const { page } = await send(r, 'alice');
    await settle();
    expect(codes(alice)).toHaveLength(0);
    const res = await postConsent(r, page, { action: 'verify', code: '00000000' });
    expect(res.status).toBe(400);
  });

  it('sends nothing for no owner, an offline owner, or the flag agent, and no code works', async () => {
    r = await consentRig({}, { flag: { worldId: 'w1', userId: 'flagbot' } });
    addAgent(r, 'noown', null);
    addAgent(r, 'offown', 'ghost');
    const owner = await pairModule(r.h, 'owner');
    const mods = [];
    for (const u of ['noown', 'offown', 'flagbot']) mods.push(await pairModule(r.h, u));
    modules.push(owner, ...mods);
    for (const u of ['noown', 'offown', 'flagbot']) {
      const { page } = await send(r, u);
      await settle();
      const res = await postConsent(r, page, { action: 'verify', code: '00000000' });
      expect(res.status).toBe(400);
    }
    for (const m of [owner, ...mods]) expect(codes(m)).toHaveLength(0);
  });

  it('answers identically for every kind of target, on send and on a wrong code', async () => {
    r = await consentRig({}, { flag: { worldId: 'w1', userId: 'flagbot' } });
    addAgent(r, 'bot', 'owner');
    addAgent(r, 'noown', null);
    addAgent(r, 'offown', 'ghost');
    const mods = [];
    for (const u of ['owner', 'bot', 'noown', 'offown', 'flagbot', 'alice']) {
      mods.push(await pairModule(r.h, u));
    }
    modules.push(...mods);
    r.h.store.createPairing({
      id: 'p-off',
      tokenHash: 'h-off',
      worldId: 'w1',
      userId: 'bob',
      userName: 'bob',
      origin: 'http://localhost:30000',
    });
    const seen: { u: string; send: unknown; wrong: unknown }[] = [];
    for (const u of ['alice', 'bob', 'bot', 'noown', 'offown', 'flagbot', 'unknown']) {
      r.clock.t += 61 * 60_000; // keep the registration rate limit out of the comparison
      const { page, reply } = await send(r, u);
      const wrong = await postConsent(r, page, { action: 'verify', code: '11111111' });
      const norm = (b: string) => b.replaceAll(page.rid, 'RID').replaceAll(page.csrf, 'CSRF');
      seen.push({
        u,
        send: [reply.status, norm(reply.body)],
        wrong: [wrong.status, norm(wrong.body)],
      });
    }
    for (const s of seen) expect({ ...s, u: '' }).toEqual({ ...seen[0]!, u: '' });
  });

  it('never sends a code to a headless connection, even when the lookup says it is no agent', async () => {
    let headless = false;
    r = await consentRig({}, {}, { isHeadlessAgent: () => headless });
    const bot = await pairModule(r.h, 'bot');
    modules.push(bot);
    headless = true;
    modules.push(await reconnectModule(r.h, bot));
    const { page } = await send(r, 'bot');
    await settle();
    expect(modules.flatMap((m) => codes(m))).toHaveLength(0);
    const res = await postConsent(r, page, { action: 'verify', code: '00000000' });
    expect(res.status).toBe(400);
  });

  it('names the agent from its current (newest) pairing', async () => {
    r = await consentRig({}, {});
    addAgent(r, 'bot', 'owner');
    const owner = await pairModule(r.h, 'owner');
    modules.push(owner);
    modules.push(await pairModule(r.h, 'bot', { userName: 'Old' }));
    modules.push(await pairModule(r.h, 'bot', { userName: 'New' }));
    await send(r, 'bot');
    const frame = (await owner.tc.next('consentCode')) as { forAgent?: { name: string } };
    expect(frame.forAgent?.name).toBe('New');
  });
});
