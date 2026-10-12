import { expect, it } from 'vitest';
import {
  assertTask27Privacy,
  assertTask27Sequence,
  task27CapturedFrame,
  task27Pins,
  task27Plan,
} from './native-plan.js';
const frame = (seq: number, connection = 'a', extra = {}) => ({
  connection,
  receivedAt: 0,
  event: { seq, ts: 0, type: 'chat', summary: 'A chat message was posted', userId: 'u', ...extra },
});
it('pins reviewed builds and accounts for the native v14 Scene Level', () => {
  expect(task27Pins().source).toHaveLength(40);
  expect(() => task27Pins('main')).toThrow();
  expect(task27Plan('123456789abc', 14).fixtureCount).toBe(8);
  expect(task27Plan('123456789abc', 13).fixtureCount).toBe(7);
  expect(task27Plan('123456789abc', 14).scene.levels).toHaveLength(1);
  expect(task27Plan('123456789abc', 13).scene).not.toHaveProperty('levels');
});
it('accepts per-connection sequence resets and rejects old-frame replay', () => {
  expect(() => assertTask27Sequence([frame(1), frame(2), frame(1, 'b')])).not.toThrow();
  expect(() => assertTask27Sequence([frame(2)])).toThrow();
  expect(() => assertTask27Sequence([frame(1), frame(1)])).toThrow();
});
it('rejects private references, body text and a relabeled observer in actual frame shapes', () => {
  expect(() => assertTask27Privacy([frame(1)], ['secret'], 'u')).not.toThrow();
  expect(() =>
    assertTask27Privacy(
      [
        frame(1, 'a', {
          doc: { uuid: 'ChatMessage.secret', type: 'ChatMessage', name: 'Chat message' },
        }),
      ],
      ['secret'],
      'u',
    ),
  ).toThrow();
  expect(() =>
    assertTask27Privacy([frame(1, 'a', { summary: 'secret body' })], ['secret'], 'u'),
  ).toThrow();
  expect(() => assertTask27Privacy([frame(1)], [], 'other')).toThrow();
});

it('fails closed for oversized or malformed known-link frames without retaining credentials', () => {
  expect(() => task27CapturedFrame('{"type":"event"')).toThrow();
  expect(() => task27CapturedFrame('x'.repeat(1024 * 1024 + 1))).toThrow();
  expect(() =>
    task27CapturedFrame(JSON.stringify({ type: 'event', event: { seq: 1, private: 'leak' } })),
  ).toThrow();
  expect(
    task27CapturedFrame(
      JSON.stringify({
        type: 'welcome',
        gatewayVersion: '0.1.0',
        protocolVersion: '3.0.0',
        connectionId: 'c',
        agentId: 'a',
        pairingToken: 'not-retained',
      }),
    ),
  ).toEqual({ welcome: { id: 'c', protocolVersion: '3.0.0' } });
});
