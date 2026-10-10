/** @typedef {import('../../../module/src/packs/api.js').PackContext} PackContext */
/** @typedef {import('../../../module/src/packs/api.js').PackApi} PackApi */

const object = (properties, required) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const escapeHtml = (text) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** Bounded dynamic programming: at most 20 × 2001 × 100 additions. */
export function diceOdds({ count, sides, target }) {
  let distribution = [1];
  for (let die = 0; die < count; die++) {
    const next = Array(distribution.length + sides).fill(0);
    for (let sum = 0; sum < distribution.length; sum++) {
      for (let face = 1; face <= sides; face++) next[sum + face] += distribution[sum] / sides;
    }
    distribution = next;
  }
  const probability = Math.min(
    1,
    Math.max(
      0,
      distribution.reduce((total, chance, sum) => total + (sum >= target ? chance : 0), 0),
    ),
  );
  return { text: `Probability: ${probability}`, structured: { probability } };
}

/** @param {PackContext} ctx */
export async function journalStamp(ctx) {
  const { pageUuid, line } = ctx.args;
  const page = await fromUuid(pageUuid);
  const journal = page?.parent;
  const user = game.users.get(ctx.user.id);
  const forbidden = () => ({
    error: { code: 'FORBIDDEN', message: 'An owned text journal page is required' },
  });
  if (
    !user ||
    page?.documentName !== 'JournalEntryPage' ||
    journal?.documentName !== 'JournalEntry' ||
    page.type !== 'text' ||
    page.text?.format !== 1 ||
    typeof page.text?.content !== 'string' ||
    !journal.testUserPermission(user, 'OWNER') ||
    !page.testUserPermission(user, 'OWNER')
  )
    return forbidden();
  // Do not expose or modify audit records, even when a GM owns them.
  if ([page, journal].some((doc) => doc.flags?.['agent-gateway']?.auditJournal === true))
    return forbidden();
  if (!ctx.snapshot || !ctx.callOptions) return forbidden();
  await ctx.snapshot(pageUuid);
  const timestamp = new Date().toISOString();
  await page.update(
    { 'text.content': `${page.text.content}\n<p>${timestamp}: ${escapeHtml(line)}</p>` },
    ctx.callOptions,
  );
  return { text: 'Journal line appended', structured: { pageUuid, timestamp } };
}

/** Register during the synchronous registration hook, before the registry seals. @param {PackApi} api */
export function registerHelloPack(api) {
  api.registerPack({
    id: 'agent-gateway-hello-pack',
    version: '0.1.0',
    apiVersion: '1.0',
    prefix: 'hello',
    tools: [
      {
        name: 'dice_odds',
        description: 'Probability that a bounded dice sum is at least a target.',
        category: 'read',
        minRole: 'player',
        inputSchema: object(
          {
            count: { type: 'integer', description: 'Number of dice.', minimum: 1, maximum: 20 },
            sides: { type: 'integer', description: 'Faces on each die.', minimum: 2, maximum: 100 },
            target: {
              type: 'integer',
              description: 'Minimum sum required for success.',
              minimum: 1,
              maximum: 2001,
            },
          },
          ['count', 'sides', 'target'],
        ),
        outputSchema: object(
          {
            probability: {
              type: 'number',
              description: 'Probability of success.',
              minimum: 0,
              maximum: 1,
            },
          },
          ['probability'],
        ),
        handler: (ctx) => diceOdds(ctx.args),
      },
      {
        name: 'journal_stamp',
        description: 'Append an escaped timestamped line to an owned HTML journal page.',
        category: 'write',
        minRole: 'player',
        inputSchema: object(
          {
            pageUuid: {
              type: 'string',
              description: 'UUID of the owned text journal page.',
              minLength: 1,
              maxLength: 256,
            },
            line: {
              type: 'string',
              description: 'Plain text line to append.',
              minLength: 1,
              maxLength: 2000,
            },
          },
          ['pageUuid', 'line'],
        ),
        outputSchema: object(
          {
            pageUuid: { type: 'string', description: 'UUID of the updated page.', maxLength: 256 },
            timestamp: {
              type: 'string',
              description: 'ISO timestamp of the appended line.',
              maxLength: 64,
            },
          },
          ['pageUuid', 'timestamp'],
        ),
        handler: journalStamp,
      },
    ],
  });
}

Hooks.on('agentGateway.registerPacks', registerHelloPack);
