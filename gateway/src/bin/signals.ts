export interface SignalTarget {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
}

const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/** Runs `shutdown` at most once, whichever of SIGINT, SIGTERM or SIGHUP arrives first. */
export function installShutdownSignals(shutdown: () => void, proc: SignalTarget = process): void {
  let started = false;
  const onSignal = () => {
    if (started) return;
    started = true;
    shutdown();
  };
  for (const signal of SHUTDOWN_SIGNALS) proc.once(signal, onSignal);
}
