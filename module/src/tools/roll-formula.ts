/* eslint-disable @typescript-eslint/no-explicit-any */
import { rollFormula } from '@agent-gateway/protocol';
import { createAgentMessage } from './chat-post.js';
import { defineWriteHandler, escapeHtml, invalid, trustedUser } from './_write.js';

declare const Roll: any;
declare const CONST: any;

/** Restrict native Roll parsing to a small finite arithmetic/dice grammar before evaluation. */
export function checkRollFormula(formula: string): void {
  if (!formula || formula.length > 200) invalid('Formula must contain at most 200 characters');
  const tokens = formula.match(/(?:\d+(?:\.\d+)?|[dD()+*/-])/g) ?? [];
  if (
    tokens.join('').toLowerCase() !== formula.replace(/\s/g, '').toLowerCase() ||
    tokens.length > 128
  )
    invalid('Only bounded numbers, dice, parentheses and arithmetic are supported');
  let at = 0;
  let dice = 0;
  const number = (): number => {
    const token = tokens[at++];
    if (!token || !/^\d+(?:\.\d+)?$/.test(token)) invalid('Expected a number');
    const value = Number(token);
    if (!Number.isFinite(value) || value > 1000000) invalid('Number exceeds the roll bound');
    return value;
  };
  const atom = (depth: number): void => {
    if (depth > 8) invalid('Formula nesting exceeds 8 levels');
    if (tokens[at] === '+' || tokens[at] === '-') {
      at++;
      atom(depth + 1);
      return;
    }
    if (tokens[at] === '(') {
      at++;
      sum(depth + 1);
      if (tokens[at++] !== ')') invalid('Unbalanced parentheses');
      return;
    }
    const implicit = tokens[at]?.toLowerCase() === 'd';
    const count = implicit ? 1 : number();
    if (tokens[at]?.toLowerCase() === 'd') {
      at++;
      const sides = number();
      if (
        !Number.isInteger(count) ||
        count < 1 ||
        !Number.isInteger(sides) ||
        sides < 2 ||
        sides > 1000 ||
        (dice += count) > 100
      )
        invalid('Rolls support at most 100 dice with 2 to 1000 faces');
    }
  };
  const product = (depth: number): void => {
    atom(depth);
    while (tokens[at] === '*' || tokens[at] === '/') {
      at++;
      atom(depth);
    }
  };
  const sum = (depth: number): void => {
    product(depth);
    while (tokens[at] === '+' || tokens[at] === '-') {
      at++;
      product(depth);
    }
  };
  sum(0);
  if (at !== tokens.length) invalid('Invalid roll formula');
}

export const rollFormulaHandler = defineWriteHandler({
  targets: () => [],
  async run(ctx) {
    const args = rollFormula.input.parse(ctx.args);
    checkRollFormula(args.formula);
    let roll: any;
    try {
      roll = await new Roll(args.formula).evaluate();
    } catch {
      return {
        error: { code: 'INVALID_ARGS', message: 'The roll formula could not be evaluated' },
      };
    }
    if (
      !Number.isFinite(roll.total) ||
      Math.abs(roll.total) > 1e12 ||
      !Array.isArray(roll.terms) ||
      roll.terms.length > 128
    )
      invalid('The evaluated roll exceeds supported bounds');
    const terms = roll.terms.map((term: any) => {
      const formula = String(term.formula ?? term.number ?? term.operator ?? '');
      if (formula.length > 200) invalid('The evaluated term exceeds supported bounds');
      return { formula, ...(Number.isFinite(term.total) ? { total: term.total } : {}) };
    });
    trustedUser(ctx);
    let messageUuid: string | undefined;
    if (args.toChat)
      messageUuid = await createAgentMessage(ctx, {
        content: String(roll.total),
        rolls: [roll],
        style: CONST.CHAT_MESSAGE_STYLES?.ROLL ?? 5,
        ...(args.flavor ? { flavor: escapeHtml(args.flavor) } : {}),
      });
    return {
      text: `Roll total: ${roll.total}${messageUuid ? `; message: ${messageUuid}` : ''}`,
      structured: { total: roll.total, terms, ...(messageUuid ? { messageUuid } : {}) },
    };
  },
});
