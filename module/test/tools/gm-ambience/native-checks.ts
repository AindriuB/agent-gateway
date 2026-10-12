/** Assertions shared by the real executor and offline regressions. No native effects on import. */
export function assertTask25Draw(value: unknown, reference: string, run: string, chat: boolean) {
  const result = value as
    { results?: Array<{ text: string; documentUuid?: string }>; messageUuid?: string } | undefined;
  if (!result || !Array.isArray(result.results) || result.results.length !== 2)
    throw Error('Exact two native draw results required');
  const expected = [
    { text: `ag-task25-${run} & text` },
    { text: `ag-task25-${run} reference`, documentUuid: reference },
  ];
  for (const row of expected)
    if (
      result.results.filter(
        (r) =>
          r.text === row.text &&
          r.documentUuid === ('documentUuid' in row ? row.documentUuid : undefined),
      ).length !== 1
    )
      throw Error('Native draw text/reference mismatch');
  if (
    chat
      ? typeof result.messageUuid !== 'string' || !result.messageUuid.startsWith('ChatMessage.')
      : result.messageUuid !== undefined
  )
    throw Error('Native draw chat identity mismatch');
}

/** The existing approval-status API intentionally persists text only after its pending boundary. */
export function assertTask25Completion(input: {
  result: { text: string; structured?: unknown; pendingCompletion: boolean };
  table: {
    results: Array<{ _id: string; type: string; documentUuid?: string; description: string }>;
  };
  resultIds: string[];
  reference: string;
  run: string;
  chat: boolean;
  audit: { targets: Array<{ uuid: string; existed: boolean }> };
  nativeChatUuid?: string;
}) {
  const { result, table, reference, run, chat } = input;
  if (
    table.results.length !== 2 ||
    new Set(input.resultIds).size !== 2 ||
    JSON.stringify(table.results.map((r) => r._id).sort()) !==
      JSON.stringify([...input.resultIds].sort())
  )
    throw Error('Exact captured native TableResult identities required');
  const references = table.results.filter((r) => r.type === 'document');
  const texts = table.results.filter((r) => r.type === 'text');
  if (
    references.length !== 1 ||
    references[0]!.documentUuid !== reference ||
    references[0]!.description !== `ag-task25-${run} reference` ||
    texts.length !== 1 ||
    texts[0]!.description !== `<b>ag-task25-${run} &amp; text</b>`
  )
    throw Error('Native captured result source/reference mismatch');
  const chats = input.audit.targets.filter(
    (t) => t.existed === false && t.uuid.startsWith('ChatMessage.'),
  );
  if (
    chat
      ? chats.length !== 1 || chats[0]!.uuid !== input.nativeChatUuid
      : chats.length !== 0 || input.nativeChatUuid !== undefined
  )
    throw Error('Exact correlated created chat identity mismatch');
  if (result.pendingCompletion) {
    const expected = [`ag-task25-${run} & text`, `ag-task25-${run} reference`].sort();
    if (JSON.stringify(result.text.split('\n').sort()) !== JSON.stringify(expected))
      throw Error('Exact pending terminal draw text mismatch');
  } else {
    assertTask25Draw(result.structured, reference, run, chat);
    if (
      chat &&
      (result.structured as { messageUuid?: string }).messageUuid !== input.nativeChatUuid
    )
      throw Error('Immediate structured chat identity mismatch');
  }
}

/** Foundry may render a blind-roll placeholder; actual private content must remain hidden. */
export function assertTask25PrivateChat(input: {
  gm: boolean;
  run: string;
  reference: string;
  messages: Array<{ isContentVisible: boolean }>;
  chatDOM: {
    present: boolean;
    aiMarker: boolean;
    text: string;
    formulas: string[];
    totals: string[];
    tooltip: string;
  };
}) {
  const { chatDOM, run, reference } = input;
  if (input.gm) {
    if (
      !chatDOM.present ||
      !chatDOM.aiMarker ||
      !chatDOM.text.includes(`ag-task25-${run} & text`) ||
      !chatDOM.text.includes(`ag-task25-${run} reference`) ||
      input.messages.length !== 1 ||
      input.messages[0]!.isContentVisible !== true
    )
      throw Error('GM native private AI result DOM missing');
    return;
  }
  if (
    input.messages.some((m) => m.isContentVisible !== false) ||
    chatDOM.text.includes(`ag-task25-${run}`) ||
    chatDOM.text.includes(reference) ||
    chatDOM.formulas.some((s) => s.trim() !== '' && !/^\?+$/.test(s.trim())) ||
    chatDOM.totals.some((s) => s.trim() !== '' && !/^\?+$/.test(s.trim())) ||
    chatDOM.tooltip.trim()
  )
    throw Error('Private chat payload or dice details became player-visible');
}
