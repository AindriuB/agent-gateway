/**
 * Page-side code for seed and clean, kept as plain JavaScript source. It is sent to the browser
 * as an expression, so no transpiler helper can leak into it; a unit test runs it against a
 * fake `game`. The argument is `{ mode: 'seed' | 'clean', plan, flagScope, flagKey, policySetting, restorePlayerAgents?, rateLimitSetting, e2eRateLimits, restoreRateLimits? }` and the
 * result is `{ before, after, totals, uuids, policy, rateLimits }` with per-type flagged and unflagged counts.
 */
export const FIXTURE_RUNTIME = String.raw`async (arg) => {
  const { mode, plan, flagScope, flagKey, policySetting, restorePlayerAgents, rateLimitSetting, e2eRateLimits, restoreRateLimits } = arg;
  if (!game.user.isGM) throw new Error('fixtures must run as a GM user');
  const TYPES = ['Folder', 'JournalEntry', 'ChatMessage', 'Token', 'Drawing', 'Note', 'Wall'];
  const isFlagged = (d) => d.getFlag(flagScope, flagKey) === true;
  const scene = game.scenes.active;
  // Fixtures may sit on any scene (the active scene can change); sweep them all.
  const allScenes = () => game.scenes.contents;
  const world = {
    Folder: () => game.folders.contents,
    JournalEntry: () => game.journal.contents,
    ChatMessage: () => game.messages.contents,
  };
  const embedded = { Token: 'tokens', Drawing: 'drawings', Note: 'notes', Wall: 'walls' };
  const docs = (type) => {
    if (world[type]) return world[type]();
    return allScenes().flatMap((sc) => sc[embedded[type]].contents);
  };
  const folderDocs = () => game.folders.contents.filter((f) => f.type === 'JournalEntry');
  const count = () => {
    const out = {};
    for (const t of TYPES) {
      const list = t === 'Folder' ? folderDocs() : docs(t);
      const flagged = list.filter(isFlagged).length;
      out[t] = { flagged, unflagged: list.length - flagged };
    }
    return out;
  };
  const before = count();
  const policy = {};
  const rateLimits = {};
  if (mode === 'seed') {
    // Player agents are off in a fresh world. Read the setting first so a missing module setting
    // fails the seed with a clear message, then record what was there for clean to restore.
    try {
      policy.before = game.settings.get(policySetting.scope, policySetting.key) === true;
    } catch (e) {
      throw new Error('the world setting ' + policySetting.scope + '.' + policySetting.key + ' is not registered: rebuild and reload the module (' + e.message + ')');
    }
  }
  if (mode === 'seed') {
    // The product default (60 reads a minute) would trip the suites. Record the stored value for clean.
    try {
      rateLimits.before = String(game.settings.get(rateLimitSetting.scope, rateLimitSetting.key));
    } catch (e) {
      throw new Error('the world setting ' + rateLimitSetting.scope + '.' + rateLimitSetting.key + ' is not registered: rebuild and reload the module (' + e.message + ')');
    }
  }
  if (mode === 'seed' && !scene) {
    throw new Error('no active scene: activate a scene in the world first; the seed does not create one');
  }
  const wipe = async () => {
    for (const sc of allScenes()) {
      for (const t of ['Token', 'Drawing', 'Note', 'Wall']) {
        const ids = sc[embedded[t]].contents.filter(isFlagged).map((d) => d.id);
        if (ids.length) await sc.deleteEmbeddedDocuments(t, ids);
      }
    }
    const msgs = game.messages.contents.filter(isFlagged).map((d) => d.id);
    if (msgs.length) await getDocumentClass('ChatMessage').deleteDocuments(msgs);
    const entries = game.journal.contents.filter(isFlagged).map((d) => d.id);
    if (entries.length) await getDocumentClass('JournalEntry').deleteDocuments(entries);
    const folders = folderDocs().filter(isFlagged).map((d) => d.id);
    if (folders.length) await getDocumentClass('Folder').deleteDocuments(folders);
  };
  await wipe();
  const totals = {};
  const uuids = {};
  if (mode === 'seed') {
    const refs = {};
    const gmIds = game.users.contents.filter((u) => u.isGM).map((u) => u.id);
    const userId = (name) => {
      const u = game.users.getName(name);
      if (!u) throw new Error('no Foundry user named ' + name);
      return u.id;
    };
    const resolve = (v) => {
      if (Array.isArray(v)) return v.map(resolve);
      if (v && typeof v === 'object') {
        if ('$ref' in v) {
          if (!(v.$ref in refs)) throw new Error('unknown fixture ref ' + v.$ref);
          return refs[v.$ref];
        }
        if ('$user' in v) return userId(v.$user);
        if ('$gms' in v) return gmIds;
        const out = {};
        for (const [k, x] of Object.entries(v)) out[k] = resolve(x);
        return out;
      }
      return v;
    };
    for (const step of plan) {
      const data = resolve(step.data);
      if (step.roll) {
        const roll = await new Roll(step.roll).evaluate();
        data.rolls = [roll.toJSON()];
        if (step.recordTotal) totals[step.recordTotal] = roll.total;
      }
      let created;
      if (step.parent === 'scene') {
        [created] = await scene.createEmbeddedDocuments(step.type, [data]);
      } else {
        created = await getDocumentClass(step.type).create(data);
      }
      if (step.ref) {
        refs[step.ref] = created.id;
        uuids[step.ref] = created.uuid;
      }
    }
    uuids.activeScene = scene.uuid;
    await game.settings.set(policySetting.scope, policySetting.key, true);
    policy.after = game.settings.get(policySetting.scope, policySetting.key) === true;
    await game.settings.set(rateLimitSetting.scope, rateLimitSetting.key, e2eRateLimits);
    rateLimits.after = String(game.settings.get(rateLimitSetting.scope, rateLimitSetting.key));
  }
  if (mode === 'clean' && typeof restorePlayerAgents === 'boolean') {
    await game.settings.set(policySetting.scope, policySetting.key, restorePlayerAgents);
    policy.after = game.settings.get(policySetting.scope, policySetting.key) === true;
  }
  if (mode === 'clean' && typeof restoreRateLimits === 'string') {
    await game.settings.set(rateLimitSetting.scope, rateLimitSetting.key, restoreRateLimits);
    rateLimits.after = String(game.settings.get(rateLimitSetting.scope, rateLimitSetting.key));
  }
  return { before, after: count(), totals, uuids, policy, rateLimits };
}`;
