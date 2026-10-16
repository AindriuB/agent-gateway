import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseImageUploadText } from '@agent-gateway/protocol/tools';
import type { CallResult, GatewayProcess } from '../lib/gateway.js';
import { loadContext } from '../lib/context.js';
import { RECONNECT_MS, Rig } from '../multi/rig.js';

// Needs the repository owner's per-run approval: AGENT_GATEWAY_E2E_IMAGE=1. One Rig keeps the GM
// and player browsers open; the gateway is bound to one user at a time and swapped once, from the
// GM to the player. beforeAll uploads a 1x1 PNG as the GM (one approval) and creates, natively in
// the GM page, an Actor the player owns, an Actor with no permission, an Actor the player can see
// (LIMITED), and a LIMITED Scene holding a hidden Token of the LIMITED Actor. afterAll deletes
// each by its exact UUID. The uploaded file cannot be deleted through the API: its path is printed
// for the operator to delete by hand.
const enabled = process.env.AGENT_GATEWAY_E2E_IMAGE === '1';

const APPROVAL_TTL_MS = 60 * 60_000;
const humanTimeout = (approvals: number): number => approvals * APPROVAL_TTL_MS + 5 * 60_000;

// A valid 1x1 PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const blocks = (raw: unknown): Array<{ type: string }> =>
  ((raw as { content?: Array<{ type: string }> }).content ?? []) as Array<{ type: string }>;

const log = (msg: string): void => console.log(`[image-view] ${msg}`);

/** One log line for a browser console message; token-like and pairing-code text is masked. */
const consoleLine = (user: string, type: string, text: string): string => {
  const safe = text
    .replace(
      /(pairing\s*code|code|token|secret|password|authorization|bearer)\s*[:=]?\s*\S+/gi,
      '$1 [redacted]',
    )
    .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
    .slice(0, 500);
  return `${user} console ${type}: ${safe}`;
};

/** Rejects with an error naming `phase` if `p` has not settled within `ms`; never waits forever. */
async function bounded<T>(phase: string, ms: number, p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[image-view] phase "${phase}" did not finish within ${ms} ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read-only recorder installed in the GM page before any call: the module exposes neither its
 * approval manager nor its controller, so pending requests are seen the way an outside listener
 * sees them (the module hook payloads and the module socket), plus the persisted queue.
 * Function source for evalGm.
 */
const GM_PROBE_INSTALL = `() => {
  if (window.__agProbe) return true;
  const shape = (p) => ({
    id: p && p.id, tool: p && p.tool, local: p && p.local, agentId: p && p.agentId,
    sessionId: p && p.sessionId, approver: p && p.approver, category: p && p.category,
    argKeys: p && p.args && typeof p.args === 'object' ? Object.keys(p.args) : [],
    argBytes: p && p.args && typeof p.args === 'object'
      ? Object.fromEntries(Object.entries(p.args).map(([k, v]) => [k, typeof v === 'string' ? v.length : JSON.stringify(v ?? null).length]))
      : null,
    at: Date.now(),
  });
  const probe = { requested: [], resolved: [], socket: [] };
  Hooks.on('agentGateway.approvalRequested', (p) => { probe.requested.push(shape(p)); });
  Hooks.on('agentGateway.approvalResolved', (p) => { probe.resolved.push({ id: p && p.id, status: p && p.status, local: p && p.local, at: Date.now() }); });
  game.socket.on('module.agent-gateway', (d, sender) => {
    probe.socket.push({ t: d && d.t, id: d && d.id, sender, at: Date.now() });
  });
  window.__agProbe = probe;
  return true;
}`;

/** Read-only dump of the GM page's approval UI state (task 150 diagnosis). Function source for evalGm. */
const GM_APPROVAL_STATE = `async () => {
  const out = {};
  const probe = window.__agProbe;
  const bytes = (v) => typeof v === 'string' ? v.length : JSON.stringify(v ?? null).length;
  const reviewable = (value) => {
    const stack = [{ value, depth: 0 }]; const seen = new WeakSet(); let nodes = 0; let chars = 0;
    while (stack.length) {
      const job = stack.pop();
      if (++nodes > 20000 || job.depth > 64) return false;
      if (typeof job.value === 'string') chars += job.value.length;
      if (chars > 1000000) return false;
      if (job.value !== null && typeof job.value === 'object') {
        if (seen.has(job.value)) return false;
        seen.add(job.value);
        for (const key in job.value) {
          if (!Object.hasOwn(job.value, key)) continue;
          chars += key.length;
          if (stack.length >= 20000 || chars > 1000000) return false;
          stack.push({ value: job.value[key], depth: job.depth + 1 });
        }
      }
    }
    return true;
  };
  try {
    out.isGM = game.user?.isGM === true;
    out.user = { id: game.user?.id, active: game.user?.active };
    out.hookRequested = probe ? probe.requested : 'probe not installed';
    out.hookResolved = probe ? probe.resolved : null;
    out.socketSeen = probe ? probe.socket.slice(-20) : null;
    try {
      const all = JSON.parse(localStorage.getItem('agent-gateway.' + game.world?.id + '.approvalQueue') || '{}');
      const mine = Array.isArray(all[game.user?.id]) ? all[game.user.id] : [];
      out.storedQueueUsers = Object.keys(all);
      out.storedOwn = mine.map((r) => ({
        id: r.id, tool: r.tool, status: r.status, approver: r.approver, agentId: r.agentId,
        sessionId: r.sessionId, requesterId: r.requesterId, agentOwnerId: r.agentOwnerId,
        argKeys: r.args && typeof r.args === 'object' ? Object.keys(r.args) : [],
        argBytes: r.args && typeof r.args === 'object' ? Object.fromEntries(Object.entries(r.args).map(([k, v]) => [k, bytes(v)])) : null,
        reviewable: reviewable(r.args),
      }));
    } catch (e) { out.storedQueueError = String(e && e.message); }
    const ev = Hooks.events || {};
    const describe = (name) => (ev[name] || []).map((h) => ({ id: h.id, once: h.once, src: String(h.fn).slice(0, 80) }));
    out.hooks = { requested: describe('agentGateway.approvalRequested'), resolved: describe('agentGateway.approvalResolved'), updateUser: (ev.updateUser || []).length };
    const ctl = (ev['agentGateway.approvalResolved'] || []).find((h) => /this\\.refresh\\(\\)/.test(String(h.fn)));
    out.controllerInstalled = !!ctl;
    const apps = [];
    const seenApps = new Set();
    const add = (a, via) => {
      if (!a || seenApps.has(a)) return;
      seenApps.add(a);
      const label = String(a.id) + ' ' + String(a.constructor && a.constructor.name) + ' ' + String(a.options && a.options.id);
      if (!/approv|agent-gateway/i.test(label)) return;
      const el = a.element;
      const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      const cs = el ? getComputedStyle(el) : null;
      apps.push({
        via, id: a.id, cls: a.constructor && a.constructor.name, rendered: a.rendered, state: a.state,
        minimized: a.minimized,
        position: a.position ? { left: a.position.left, top: a.position.top, width: a.position.width, height: a.position.height, zIndex: a.position.zIndex } : null,
        connected: el ? el.isConnected : null,
        rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
        display: cs ? cs.display : null, visibility: cs ? cs.visibility : null, opacity: cs ? cs.opacity : null,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        groups: Array.isArray(a.groups) ? a.groups.map((g) => ({ id: g.id, requests: g.requests.map((q) => q.id) })) : undefined,
        page: a.page,
        articles: el ? el.querySelectorAll('article[data-request]').length : null,
      });
    };
    for (const a of foundry.applications.instances.values()) add(a, 'instances');
    for (const a of Object.values(ui.windows || {})) add(a, 'ui.windows');
    out.apps = apps;
    out.appCount = { instances: foundry.applications.instances.size, windows: Object.keys(ui.windows || {}).length };
    out.dom = Array.from(document.querySelectorAll('[id*=approval], .ag-approval')).slice(0, 6).map((e) => ({ tag: e.tagName, id: e.id, cls: String(e.className).slice(0, 60) }));
    const errs = [];
    const onRej = (e2) => errs.push('unhandledrejection: ' + String(e2.reason && (e2.reason.stack || e2.reason)).slice(0, 500));
    const origErr = console.error;
    console.error = (...a) => { errs.push('console.error: ' + a.map((x) => String((x && x.stack) || x)).join(' ').slice(0, 500)); };
    window.addEventListener('unhandledrejection', onRej);
    try {
      if (ctl) ctl.fn();
      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      errs.push('threw: ' + String((e && (e.stack || e)) || e).slice(0, 500));
    } finally {
      window.removeEventListener('unhandledrejection', onRej);
      console.error = origErr;
    }
    out.refreshAgain = { called: !!ctl, errors: errs };
    out.appsAfterRefresh = Array.from(foundry.applications.instances.values()).filter((a) => /approv|agent-gateway/i.test(String(a.id))).map((a) => ({ id: a.id, rendered: a.rendered, state: a.state, articles: a.element ? a.element.querySelectorAll('article[data-request]').length : null }));
  } catch (e) {
    out.probeError = String((e && (e.stack || e)) || e).slice(0, 500);
  }
  return JSON.stringify(out);
}`;

/** The longest settle() polls: the approval TTL plus a minute, so a lost approval fails by name. */
const SETTLE_MAX_MS = APPROVAL_TTL_MS + 60_000;

/** Settles an approval on the gateway that made the call. */
async function settle(
  gateway: GatewayProcess,
  r: CallResult,
  dumpGm?: () => Promise<string>,
): Promise<CallResult> {
  if (r.structured?.status !== 'pending_approval') return r;
  const id = String(r.structured.id);
  const started = Date.now();
  let last = '';
  let lastBeat = started;
  let dumped = false;
  while (Date.now() - started < SETTLE_MAX_MS) {
    const current = await bounded(
      `approval_status ${id}`,
      90_000,
      gateway.call('approval_status', { id }),
    );
    if (current.isError) throw new Error(`approval_status ${id} failed: ${current.text}`);
    const status = String(current.structured?.status);
    if (status !== last) {
      log(`approval ${id} status ${last || '(first poll)'} -> ${status}`);
      last = status;
    } else if (Date.now() - lastBeat >= 60_000) {
      log(`approval ${id} still ${status} after ${Math.round((Date.now() - started) / 1000)} s`);
    }
    if (Date.now() - lastBeat >= 60_000) lastBeat = Date.now();
    if (!dumped && dumpGm && status === 'pending' && Date.now() - started >= 60_000) {
      dumped = true;
      try {
        log(`GM approval state: ${(await dumpGm()).slice(0, 4000)}`);
      } catch (e) {
        log(`GM approval state: dump failed: ${String(e).slice(0, 300)}`);
      }
    }
    if (status === 'approved' && typeof current.structured?.result === 'string')
      return {
        ...current,
        isError: current.structured?.resultFailed === true,
        text: String(current.structured.result),
      };
    if (status === 'denied' || status === 'expired' || status === 'unknown')
      throw new Error(`approval ${id} ended ${status}: ${current.text}`);
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(
    `[image-view] phase "waiting for approval ${id}" did not finish within ${SETTLE_MAX_MS} ms (last status ${last})`,
  );
}

describe.skipIf(!enabled)('image_view', () => {
  const ctx = loadContext();
  const gmUser = ctx.config.gmUser;
  const playerUser = ctx.config.playerUser;
  let rig: Rig | undefined;
  let bound: string | undefined;
  let probePath: string;
  let ownedActor: string;
  let noPermActor: string;
  let limitedActor: string;
  let hiddenToken: string;
  let bgScene: string;
  const created: string[] = [];
  const uploaded: string[] = [];

  const evalGm = <T>(fn: string, arg: unknown): Promise<T> =>
    bounded(
      'GM page evaluate',
      60_000,
      rig!.users
        .get(gmUser)!
        .browser.page.evaluate(`(${fn})(${JSON.stringify(arg)})`) as Promise<T>,
    );
  /** The gateway bound to `user`; swaps only when the binding differs. */
  const as = async (user: string): Promise<GatewayProcess> => {
    if (bound !== user) {
      bound = undefined; // a swap that fails partway leaves the binding unknown
      log(`swapping the gateway to ${user}`);
      await bounded(`gateway swap to ${user}`, RECONNECT_MS + 60_000, rig!.swap(user));
      bound = user;
      log(`gateway bound to ${user}`);
    }
    const gw = rig!.gateway!;
    const info = await gw.call('world_info');
    expect(info.isError, `world_info as ${user}: ${info.text}`).toBe(false);
    expect(info.structured?.userName, `gateway is bound to the wrong user: ${info.text}`).toBe(
      user,
    );
    expect(
      ['GAMEMASTER', 'ASSISTANT'].includes(String(info.structured?.userRole)),
      `isGM mismatch for ${user} (role ${String(info.structured?.userRole)})`,
    ).toBe(user === gmUser);
    return gw;
  };
  /** Creates a document natively in the GM page and records its UUID for afterAll. */
  const createDoc = async (expr: string, arg: unknown): Promise<string> => {
    const uuid = await evalGm<string>(expr, arg);
    expect(typeof uuid).toBe('string');
    created.push(uuid);
    log(`created ${uuid}`);
    return uuid;
  };

  beforeAll(
    async () => {
      rig = new Rig(ctx);
      log(`rig open: gateway bound to ${gmUser}, joining ${gmUser} and ${playerUser}`);
      await bounded(
        'rig open (gateway, browsers, welcomes)',
        RECONNECT_MS + 150_000,
        rig.open(gmUser, [gmUser, playerUser]),
      );
      for (const [user, u] of rig.users) {
        u.browser.page.on('console', (m) => {
          const type = m.type();
          if (type === 'error' || type === 'warning') log(consoleLine(user, type, m.text()));
        });
        u.browser.page.on('pageerror', (e) => log(consoleLine(user, 'pageerror', e.message)));
      }
      log(
        `browsers welcomed: ${[...rig.users].map(([k, u]) => `${k}=${u.frames.welcomes}`).join(', ')}`,
      );
      bound = gmUser;
      const gw = await as(gmUser);
      log(`gateway bound to ${gmUser}`);
      await evalGm<boolean>(GM_PROBE_INSTALL, null).catch((e: unknown) =>
        log(`GM approval probe install failed: ${String(e).slice(0, 200)}`),
      );
      const first = await bounded(
        'image_upload call (no approval wait; the module answers within about 25 s)',
        90_000,
        gw.call('image_upload', { data: PNG_B64, mime: 'image/png' }),
      );
      log(
        `image_upload sent: isError=${String(first.isError)} status=${String(first.structured?.status)} approval id=${String(first.structured?.id)}${first.isError ? ` text=${first.text.slice(0, 200)}` : ''}`,
      );
      if (first.structured?.status === 'pending_approval')
        log(
          `WAITING for the GM to approve image_upload ${String(first.structured.id)} in the GM window`,
        );
      const up = await settle(gw, first, () => evalGm<string>(GM_APPROVAL_STATE, null));
      log(`image_upload settled: isError=${String(up.isError)}`);
      const parsed = parseImageUploadText(up.text);
      if (!up.isError && parsed) uploaded.push(parsed.path);
      expect(up.isError, up.text).toBe(false);
      expect(parsed, 'the image_upload result names the file').toBeTruthy();
      probePath = parsed!.path;
      const actor = (name: string, ownership: number): Promise<string> =>
        createDoc(`async (d) => (await Actor.create(d)).uuid`, {
          name,
          type: 'character',
          img: probePath,
          ownership: { default: ownership },
        });
      // As in the real world: explicit per-user OWNER for the player, default 0 (NONE).
      ownedActor = await createDoc(
        `async (d) => { const u = game.users.getName(d.player); if (!u) throw new Error('no player user ' + d.player); return (await Actor.create({ name: d.name, type: 'character', img: d.img, ownership: { default: 0, [u.id]: 3 } })).uuid; }`,
        {
          name: 'agent-gateway e2e view owned (temporary)',
          player: playerUser,
          img: probePath,
        },
      );
      // The player's own client must see the Actor as OWNER before any tool call.
      log('OWNER wait: the player client must see the owned Actor');
      const ownerSeen = await bounded(
        'OWNER wait (player client)',
        60_000,
        rig.users.get(playerUser)!.browser.page.evaluate(
          `(async (uuid) => {
            for (let i = 0; i < 40; i++) {
              const a = await fromUuid(uuid);
              if (a && a.testUserPermission(game.user, 'OWNER') === true) return true;
              await new Promise((r) => setTimeout(r, 250));
            }
            return false;
          })(${JSON.stringify(ownedActor)})`,
        ) as Promise<boolean>,
      );
      log(`OWNER wait done: ${String(ownerSeen)}`);
      expect(ownerSeen, 'player client sees the owned Actor as OWNER').toBe(true);
      noPermActor = await actor('agent-gateway e2e view no-permission (temporary)', 0);
      // LIMITED (1) on this Actor and on the Scene below: the player can see both, so only
      // token.hidden can refuse the Token.
      limitedActor = await actor('agent-gateway e2e view limited (temporary)', 1);
      const sceneUuid = await createDoc(`async (d) => (await Scene.create(d)).uuid`, {
        name: 'agent-gateway e2e view scene (temporary)',
        ownership: { default: 1 },
      });
      hiddenToken = await createDoc(
        `async ([sceneUuid, actorUuid, src]) => {
        const scene = await fromUuid(sceneUuid);
        const actor = await fromUuid(actorUuid);
        const [t] = await scene.createEmbeddedDocuments('Token', [
          { name: actor.name, actorId: actor.id, x: 0, y: 0, hidden: true, texture: { src } },
        ]);
        return t.uuid;
      }`,
        [sceneUuid, limitedActor, probePath],
      );
      // A Scene whose background is the uploaded PNG: v14 reads the Level the tools use
      // (initialLevel, then defaultLevel0000, then the first Level), v13 scene.background.src.
      bgScene = await createDoc(
        `async ([name, src]) => {
          const scene = await Scene.create({ name });
          if (game.release.generation >= 14) {
            const levels = scene.levels.contents;
            const level =
              (scene.initialLevel && scene.levels.get(scene.initialLevel)) ||
              scene.levels.get('defaultLevel0000') ||
              levels[0];
            if (!level) throw new Error('the temporary Scene has no Level');
            await level.update({ 'background.src': src });
          } else {
            await scene.update({ 'background.src': src });
          }
          return scene.uuid;
        }`,
        ['agent-gateway e2e view background scene (temporary)', probePath],
      );
    },
    humanTimeout(1) + RECONNECT_MS,
  );

  afterAll(async () => {
    const failures: string[] = [];
    const gmOpen = rig?.users.has(gmUser) === true;
    if (created.length && !gmOpen)
      failures.push(
        `RESIDUE: temporary documents ${created.join(', ')} may still exist: no GM page`,
      );
    if (gmOpen) {
      // Reverse order, so the embedded Token goes before its Scene.
      for (const uuid of [...created].reverse()) {
        try {
          await evalGm(`async (u) => { await (await fromUuid(u))?.delete(); }`, uuid);
        } catch (e) {
          failures.push(
            `RESIDUE: temporary document ${uuid} may still exist: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }
    if (uploaded.length)
      console.log(`UPLOADED FILES (delete by hand from the Data folder):\n${uploaded.join('\n')}`);
    try {
      await rig?.close();
    } catch (e) {
      failures.push(`RESIDUE: close: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (failures.length > 0) throw new Error(failures.join('; '));
  }, 15 * 60_000);

  // GM tests first, then the player tests, so the gateway swaps once.
  it('a GM views a temporary scene background as one image block', async () => {
    const gw = await as(gmUser);
    const r = await gw.call('image_view', {
      source: 'scene_background',
      uuid: bgScene,
    });
    expect(r.isError, r.text).toBe(false);
    expect(blocks(r.raw).filter((b) => b.type === 'image')).toHaveLength(1);
    expect(r.structured).toBeUndefined();
  });

  it('a GM views a data file', async () => {
    const gw = await as(gmUser);
    const r = await gw.call('image_view', { source: 'file', path: probePath });
    expect(r.isError, r.text).toBe(false);
    expect(blocks(r.raw).filter((b) => b.type === 'image')).toHaveLength(1);
  });

  it(
    'a player views an owned Actor portrait',
    async () => {
      const gw = await as(playerUser);
      const r = await gw.call('image_view', { source: 'actor_portrait', uuid: ownedActor });
      expect(r.isError, r.text).toBe(false);
      expect(blocks(r.raw).filter((b) => b.type === 'image')).toHaveLength(1);
    },
    humanTimeout(0) + RECONNECT_MS,
  );

  it('a player is refused a hidden token they do not own and an Actor with no permission', async () => {
    const gw = await as(playerUser);
    for (const [source, uuid] of [
      ['token', hiddenToken],
      ['actor_portrait', noPermActor],
    ] as const) {
      const r = await gw.call('image_view', { source, uuid });
      expect(r.isError, `${source} must be refused for ${playerUser}; got: ${r.text}`).toBe(true);
      expect(r.text, `${source} refusal text: ${r.text}`).toContain('FORBIDDEN');
      expect(
        blocks(r.raw).some((b) => b.type === 'image'),
        `${source} returned an image block: ${r.text}`,
      ).toBe(false);
    }
  });
});
