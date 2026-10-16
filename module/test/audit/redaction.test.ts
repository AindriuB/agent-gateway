import { randomBytes } from 'node:crypto';
import { imageUpload } from '@agent-gateway/protocol';
import { describe, expect, it } from 'vitest';
import { createAuditStage } from '../../src/audit/stage.js';
import { boundedJson } from '../../src/audit/record.js';
import type { AuditRecord } from '../../src/audit/types.js';
import { createDispatcher } from '../../src/ops/dispatch.js';
import { sha256Bytes } from '../../src/ops/redact.js';
import { makeStore } from './fake.js';

function leaks(secret: string, haystack: string): boolean {
  const grams = new Set<string>();
  for (let i = 0; i + 16 <= haystack.length; i++) grams.add(haystack.slice(i, i + 16));
  for (let i = 0; i + 16 <= secret.length; i++) if (grams.has(secret.slice(i, i + 16))) return true;
  return false;
}

async function audited(args: unknown, who = { id: 'p1', isGM: false }) {
  const records: AuditRecord[] = [];
  const store = makeStore();
  const stage = createAuditStage({
    isGM: () => true,
    categoryOf: () => 'write',
    fromUuid: store.fromUuid,
    submit: async (r) => void records.push(r),
    now: () => 5000,
    newId: () => 'entry-abcdef01',
  });
  const dispatch = createDispatcher({
    tools: [imageUpload],
    handlers: { image_upload: async () => ({ text: 'uploaded', structured: {} }) },
    stages: [stage],
  });
  await dispatch(
    {
      tool: 'image_upload',
      args,
      sessionId: 's',
      agent: { id: 'a', ownerUserId: who.id, headless: false },
    },
    who,
  );
  return records;
}

describe('audit args for image_upload', () => {
  it.each([
    ['player', { id: 'p1', isGM: false }],
    ['GM', { id: 'gm', isGM: true }],
  ])('omit the payload for a %s and keep size and SHA-256', async (_n, who) => {
    const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), randomBytes(400 * 1024)]);
    const data = bytes.toString('base64');
    const [record] = await audited({ data, mime: 'image/png' }, who);
    expect(record).toBeDefined();
    expect(record!.args).not.toContain(data.slice(100, 164));
    expect(leaks(data, record!.args)).toBe(false);
    expect(record!.args).toContain(`"bytes":${bytes.length}`);
    expect(record!.args).toContain(sha256Bytes(bytes));
    expect(record!.args).toContain('"mime":"image/png"');
  });
  it('other tools keep the exact boundedJson text', async () => {
    // A tool without redactArgs: the audit text equals boundedJson of the raw args.
    const { defineTool } = await import('@agent-gateway/protocol');
    const { z } = await import('zod');
    const plain = defineTool({
      name: 'fixture_plain',
      minRole: 'player',
      category: 'write',
      handledBy: 'module',
      description: 'x',
      input: z.strictObject({ data: z.string(), n: z.number().optional() }),
      output: z.strictObject({}),
    });
    const records: AuditRecord[] = [];
    const stage = createAuditStage({
      isGM: () => true,
      categoryOf: () => 'write',
      fromUuid: makeStore().fromUuid,
      submit: async (r) => void records.push(r),
      now: () => 5000,
      newId: () => 'entry-abcdef01',
    });
    const args = { data: 'x'.repeat(900), n: 3 };
    await createDispatcher({
      tools: [plain],
      handlers: { fixture_plain: async () => ({ text: 'ok', structured: {} }) },
      stages: [stage],
    })(
      {
        tool: 'fixture_plain',
        args,
        sessionId: 's',
        agent: { id: 'a', ownerUserId: 'p1', headless: false },
      },
      { id: 'p1', isGM: false },
    );
    expect(records[0]!.args).toBe(boundedJson(args).text);
  });
});
