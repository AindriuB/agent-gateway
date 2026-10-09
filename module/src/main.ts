declare const Hooks: { once(hook: string, fn: () => void): void };

Hooks.once('init', () => {
  console.log('agent-gateway | loaded');
});
