import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installShutdownSignals } from '../../src/bin/signals.js';

function setup() {
  const proc = new EventEmitter();
  const shutdown = vi.fn();
  installShutdownSignals(shutdown, proc);
  return { proc, shutdown };
}

describe('installShutdownSignals', () => {
  it.each(['SIGINT', 'SIGTERM', 'SIGHUP'])('%s calls shutdown exactly once', (signal) => {
    const { proc, shutdown } = setup();
    proc.emit(signal);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('the same signal twice calls shutdown once', () => {
    const { proc, shutdown } = setup();
    proc.emit('SIGHUP');
    proc.emit('SIGHUP');
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('a different signal after the first does not start a second shutdown', () => {
    const { proc, shutdown } = setup();
    proc.emit('SIGINT');
    proc.emit('SIGTERM');
    proc.emit('SIGHUP');
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
