import { describe, expect, it, vi } from 'vitest';
import { reportStartFailure } from '../../src/bin/start-failure.js';
import { LinkListenError } from '../../src/link/server.js';

describe('reportStartFailure', () => {
  it('writes one line for a LinkListenError', () => {
    const writeStderr = vi.fn();
    const exit = vi.fn();
    const err = new LinkListenError('EADDRINUSE', 7429);
    reportStartFailure(err, { writeStderr, exit });
    expect(writeStderr).toHaveBeenCalledTimes(1);
    expect(writeStderr).toHaveBeenCalledWith(`${err.message}\n`);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('keeps the generic line for other errors', () => {
    const writeStderr = vi.fn();
    const exit = vi.fn();
    reportStartFailure(new Error('boom'), { writeStderr, exit });
    expect(writeStderr).toHaveBeenCalledWith('Failed to start: Error: boom\n');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
