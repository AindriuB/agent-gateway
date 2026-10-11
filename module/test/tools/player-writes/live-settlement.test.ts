import { expect, it } from 'vitest';
import { settleLiveBatch } from './live-settlement.js';

it('waits for late successful creations and tracks their UUIDs before failure cleanup', async () => {
  let finishCreate!: (uuid: string) => void;
  const tracked: string[] = [];
  let cleanup: string[] | undefined;
  const lateCreate = new Promise<string>((resolve) => {
    finishCreate = resolve;
  }).then((uuid) => {
    tracked.push(uuid);
    return uuid;
  });
  const batch = settleLiveBatch([
    Promise.reject(Error('roll validation failed')),
    lateCreate,
  ]).catch((error) => {
    cleanup = [...tracked];
    return error;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(cleanup).toBeUndefined();
  finishCreate('ChatMessage.late');
  const error = await batch;
  expect(error).toBeInstanceOf(AggregateError);
  expect(cleanup).toEqual(['ChatMessage.late']);
  expect(error.errors).toHaveLength(1);
});

it('preserves input ordering after every successful call settles', async () => {
  expect(await settleLiveBatch([Promise.resolve('chat'), Promise.resolve('page')])).toEqual([
    'chat',
    'page',
  ]);
});
