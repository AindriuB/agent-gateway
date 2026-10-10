/**
 * The fixture set, as data. `buildSeedPlan` turns it into create steps that the in-page runtime
 * (runtime.ts) executes as the GM. Every document is named `ag-test-*` and carries
 * `flags['agent-gateway'].fixture === true`.
 */
export const FIXTURE_FLAG_SCOPE = 'agent-gateway';
export const FIXTURE_FLAG_KEY = 'fixture';
export const FIXTURE_PREFIX = 'ag-test-';
/** The player character that player1 speaks as. */
export const OWN_ACTOR_ID = '6i6mZ5g8vX8iU9RD';

export const OWNERSHIP = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } as const;

export const FIXTURE = {
  names: {
    hiddenFolder: 'ag-test-hidden-folder',
    hiddenEntry: 'ag-test-hidden',
    publicEntry: 'ag-test-public',
    limitedEntry: 'ag-test-limited',
  },
  pages: { public: 'public', gm: 'gm', markdown: 'markdown' },
  text: {
    hiddenBody: 'ag-test hidden body',
    limitedBody: 'ag-test limited body',
    publicPageVisible: 'ag-test PUBLIC-PAGE visible text',
    publicPageSecret: 'ag-test SECRET text',
    gmPage: 'ag-test GM-PAGE text',
    markdownVisible: 'ag-test MARKDOWN-PAGE visible text',
    markdownSecret: 'ag-test MARKDOWN SECRET',
    publicMessage: 'ag-test public message',
    gmWhisper: 'ag-test GM whisper',
    playerWhisper: 'ag-test player whisper',
    npcMessage: 'ag-test NPC message',
    npcSecret: 'ag-test NPC SECRET',
    ownMessage: 'ag-test own-character message',
    ownSecret: 'ag-test OWN SECRET',
  },
  chat: { blindFormula: '7d6' },
  placeables: {
    hiddenToken: 'ag-test-token-hidden',
    visibleToken: 'ag-test-token-visible',
    hiddenDrawing: 'ag-test-drawing-hidden',
    publicNote: 'ag-test-note-public',
    hiddenNote: 'ag-test-note-hidden',
  },
} as const;

/** Placeholders the runtime resolves before creating a document. */
export type Ref = { $ref: string };
export type UserRef = { $user: string };
export type GmIds = { $gms: true };

export type SeedType =
  'Folder' | 'JournalEntry' | 'ChatMessage' | 'Token' | 'Drawing' | 'Note' | 'Wall';

export interface SeedStep {
  type: SeedType;
  /** Name later steps use in `{ $ref }`. */
  ref?: string;
  /** Embedded on the active scene when 'scene'; world level otherwise. */
  parent?: 'scene';
  /** When set, the roll is evaluated in the page and its JSON appended to `rolls`. */
  roll?: string;
  /** Record the evaluated roll total in the seed result under this key. */
  recordTotal?: string;
  data: Record<string, unknown>;
}

export interface PlanInput {
  gmUser: string;
  playerUser: string;
}

const flags = () => ({ flags: { [FIXTURE_FLAG_SCOPE]: { [FIXTURE_FLAG_KEY]: true } } });
const secret = (s: string) => `<section class="secret"><p>${s}</p></section>`;

export function buildSeedPlan(input: PlanInput): SeedStep[] {
  const { names, pages, text, placeables } = FIXTURE;
  const p = input.playerUser;
  const html = (body: string) => ({ format: 1, content: body });
  return [
    {
      type: 'Folder',
      ref: 'hiddenFolder',
      data: { name: names.hiddenFolder, type: 'JournalEntry', ...flags() },
    },
    {
      type: 'JournalEntry',
      ref: 'hidden',
      data: {
        name: names.hiddenEntry,
        folder: { $ref: 'hiddenFolder' },
        ownership: { default: OWNERSHIP.NONE },
        pages: [{ name: 'hidden page', type: 'text', text: html(`<p>${text.hiddenBody}</p>`) }],
        ...flags(),
      },
    },
    {
      type: 'JournalEntry',
      ref: 'public',
      data: {
        name: names.publicEntry,
        ownership: { default: OWNERSHIP.OBSERVER },
        pages: [
          {
            name: pages.public,
            type: 'text',
            text: html(`<p>${text.publicPageVisible}</p>${secret(text.publicPageSecret)}`),
          },
          {
            name: pages.gm,
            type: 'text',
            ownership: { default: OWNERSHIP.NONE },
            text: html(`<p>${text.gmPage}</p>`),
          },
          {
            name: pages.markdown,
            type: 'text',
            text: {
              format: 2,
              content: '',
              markdown: `${text.markdownVisible}\n\n<section class="secret">${text.markdownSecret}</section>`,
            },
          },
        ],
        ...flags(),
      },
    },
    {
      type: 'JournalEntry',
      ref: 'limited',
      data: {
        name: names.limitedEntry,
        ownership: { default: OWNERSHIP.LIMITED },
        pages: [{ name: 'limited page', type: 'text', text: html(`<p>${text.limitedBody}</p>`) }],
        ...flags(),
      },
    },
    {
      type: 'Token',
      parent: 'scene',
      data: { name: placeables.hiddenToken, x: 200, y: 200, hidden: true, ...flags() },
    },
    {
      type: 'Token',
      parent: 'scene',
      data: { name: placeables.visibleToken, x: 400, y: 200, hidden: false, ...flags() },
    },
    {
      type: 'Drawing',
      parent: 'scene',
      data: {
        x: 200,
        y: 400,
        hidden: true,
        text: placeables.hiddenDrawing,
        shape: { type: 'r', width: 100, height: 100 },
        ...flags(),
      },
    },
    {
      type: 'Note',
      parent: 'scene',
      data: {
        x: 600,
        y: 200,
        entryId: { $ref: 'public' },
        text: placeables.publicNote,
        ...flags(),
      },
    },
    {
      type: 'Note',
      parent: 'scene',
      data: {
        x: 600,
        y: 400,
        entryId: { $ref: 'hidden' },
        text: placeables.hiddenNote,
        ...flags(),
      },
    },
    // Door type 2 is a secret door.
    { type: 'Wall', parent: 'scene', data: { c: [800, 200, 800, 400], door: 2, ...flags() } },
    {
      type: 'ChatMessage',
      data: {
        author: { $user: input.gmUser },
        content: `<p>${text.publicMessage}</p>`,
        ...flags(),
      },
    },
    {
      type: 'ChatMessage',
      data: {
        author: { $user: input.gmUser },
        content: `<p>${text.gmWhisper}</p>`,
        whisper: { $gms: true },
        ...flags(),
      },
    },
    {
      type: 'ChatMessage',
      data: {
        author: { $user: p },
        content: `<p>${text.playerWhisper}</p>`,
        whisper: { $gms: true },
        ...flags(),
      },
    },
    {
      type: 'ChatMessage',
      roll: FIXTURE.chat.blindFormula,
      recordTotal: 'blindRollTotal',
      data: { author: { $user: p }, content: '', blind: true, whisper: { $gms: true }, ...flags() },
    },
    {
      type: 'ChatMessage',
      data: {
        author: { $user: input.gmUser },
        speaker: { alias: 'ag-test NPC' },
        content: `<p>${text.npcMessage}</p>${secret(text.npcSecret)}`,
        ...flags(),
      },
    },
    {
      type: 'ChatMessage',
      data: {
        author: { $user: p },
        speaker: { actor: OWN_ACTOR_ID, alias: 'ag-test own character' },
        content: `<p>${text.ownMessage}</p>${secret(text.ownSecret)}`,
        ...flags(),
      },
    },
  ];
}

/** Per-type counts the seed must produce (flagged documents). */
export function expectedFlaggedCounts(): Record<SeedType, number> {
  const out: Record<SeedType, number> = {
    Folder: 0,
    JournalEntry: 0,
    ChatMessage: 0,
    Token: 0,
    Drawing: 0,
    Note: 0,
    Wall: 0,
  };
  for (const s of buildSeedPlan({ gmUser: 'gm', playerUser: 'player' })) out[s.type]++;
  return out;
}
