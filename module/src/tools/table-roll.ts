/* eslint-disable @typescript-eslint/no-explicit-any */
import { tableRoll } from '@agent-gateway/protocol';
import { defineWriteHandler, invalid, escapeHtml } from './_write.js';
import { gm, collection } from './_scene.js';
import { resolveAmbience, captureAmbience, checkAmbience } from './_ambience.js';
import { checkRollFormula } from './roll-formula.js';
import { createAgentMessage } from './chat-post.js';
declare const Roll: any;
declare const game: any;
declare const foundry: any;
export const tableRollHandler = defineWriteHandler({
  targets: () => [],
  async run(ctx) {
    const args = tableRoll.input.parse(ctx.args);
    const table = await resolveAmbience(ctx, args.tableUuid, 'RollTable');
    const { rows, validate } = captureAmbience(ctx, table, 'results');
    const formula = table._source?.formula;
    if (typeof formula !== 'string') invalid('A stored table formula is required');
    checkRollFormula(formula);
    if (typeof table.replacement !== 'boolean')
      invalid('Native table replacement setting unavailable');
    const prepared = rows.map((row) => {
      if (
        !Array.isArray(row.range) ||
        row.range.length !== 2 ||
        !row.range.every(Number.isFinite) ||
        row.range[0] > row.range[1] ||
        row.range.some((n: number) => Math.abs(n) > 1e12) ||
        typeof row.drawn !== 'boolean' ||
        !['text', 'document'].includes(row.type) ||
        typeof row.name !== 'string' ||
        typeof row.description !== 'string' ||
        row.name.length > 4000 ||
        row.description.length > 8000
      )
        invalid('Unsupported table result data');
      const documentUuid = row.type === 'document' ? row.documentUuid : undefined;
      if (
        row.type === 'document' &&
        (typeof documentUuid !== 'string' || !documentUuid || documentUuid.length > 256)
      )
        invalid('Result reference is unavailable');
      // Parse HTML only into a detached document; never enrich or execute references.
      const description =
        new DOMParser().parseFromString(row.description, 'text/html').body.textContent ?? '';
      const text = description || row.name;
      if (text.length > 4000) invalid('Result text exceeds supported bounds');
      return { row, text, documentUuid };
    });
    if (!prepared.some((r) => !r.row.drawn)) invalid('Table has no available results');
    const user = gm(ctx);
    const recipients =
      args.rollMode === 'selfroll'
        ? [user.id]
        : ['gmroll', 'blindroll'].includes(args.rollMode)
          ? collection(game.users)
              .filter((u) => u.isGM)
              .map((u) => u.id)
          : [];
    if (recipients.length > 100 || (args.rollMode !== 'publicroll' && !recipients.length))
      invalid('Native chat recipients unavailable');
    let roll: any,
      selected: typeof prepared = [];
    for (let attempt = 0; attempt < 100 && !selected.length; attempt++) {
      validate();
      roll = await new Roll(formula).evaluate();
      validate();
      if (
        !Number.isFinite(roll?.total) ||
        Math.abs(roll.total) > 1e12 ||
        !Array.isArray(roll.terms) ||
        roll.terms.length > 128
      )
        invalid('Evaluated table roll exceeds supported bounds');
      selected = prepared.filter(
        (r) => !r.row.drawn && roll.total >= r.row.range[0] && roll.total <= r.row.range[1],
      );
    }
    if (!selected.length || selected.length > 20) invalid('No bounded table result was drawn');
    if (
      selected.some(
        (r) => r.documentUuid && foundry.utils.parseUuid(r.documentUuid)?.type === 'RollTable',
      )
    )
      invalid('Nested RollTable draws are unsupported');
    if (!table.replacement) {
      await ctx.snapshot(table.uuid);
      validate();
      const result = await table.updateEmbeddedDocuments(
        'TableResult',
        selected.map((r) => ({ _id: r.row.id, drawn: true })),
        ctx.callOptions,
      );
      checkAmbience(ctx, table, 'RollTable');
      if (
        !Array.isArray(result) ||
        result.length !== selected.length ||
        new Set(result).size !== selected.length ||
        selected.some((r) => !result.includes(r.row) || !r.row.drawn)
      )
        throw new Error('Table drawn-state update did not persist');
      for (const r of selected) checkAmbience(ctx, r.row, 'TableResult');
    }
    // After our own update establish a fresh snapshot for subsequent awaited chat creation.
    const after = captureAmbience(ctx, table, 'results');
    const finalCheck = () => {
      after.validate();
      const current = gm(ctx);
      const actual =
        args.rollMode === 'selfroll'
          ? [current.id]
          : ['gmroll', 'blindroll'].includes(args.rollMode)
            ? collection(game.users)
                .filter((u) => u.isGM)
                .map((u) => u.id)
            : [];
      if (JSON.stringify([...actual].sort()) !== JSON.stringify([...recipients].sort()))
        invalid('Chat privacy recipients changed');
    };
    let messageUuid: string | undefined;
    if (args.toChat)
      messageUuid = await createAgentMessage(
        ctx,
        {
          content: selected.map((r) => escapeHtml(r.text)).join('<br>'),
          rolls: [roll],
          ...(recipients.length ? { whisper: recipients } : {}),
          ...(args.rollMode === 'blindroll' ? { blind: true } : {}),
        },
        async () => finalCheck,
      );
    finalCheck();
    return {
      text: selected.map((r) => r.text).join('\n'),
      structured: {
        results: selected.map((r) => ({
          text: r.text,
          ...(r.documentUuid ? { documentUuid: r.documentUuid } : {}),
        })),
        ...(messageUuid ? { messageUuid } : {}),
      },
    };
  },
});
