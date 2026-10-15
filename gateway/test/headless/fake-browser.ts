import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '@agent-gateway/protocol';
import type {
  BrowserLauncher,
  LaunchRequest,
  RunnerBrowser,
  RunnerPage,
} from '../../src/headless/runner.js';
import { SELECTORS } from '../../src/headless/runner.js';
import { coreAnnouncements } from '../conformance/fake-module.js';

export interface FakeWorldIds {
  worldId: string;
  userId: string;
  origin: string;
  linkPort: () => number;
}

/** A module living in a fake page: pairs with a typed code, keeps its token per profile. */
class PageModule {
  private ws: WebSocket | undefined;
  constructor(
    private readonly ids: FakeWorldIds,
    private readonly store: { token?: string },
    private readonly headless: boolean,
  ) {}

  connect(auth: { code: string } | { token: string }): void {
    const ws = new WebSocket(`ws://127.0.0.1:${this.ids.linkPort()}`, { origin: this.ids.origin });
    this.ws = ws;
    ws.on('error', () => undefined);
    ws.on('open', () =>
      ws.send(
        JSON.stringify({
          type: 'hello',
          protocolVersion: PROTOCOL_VERSION,
          moduleVersion: '0',
          foundryVersion: '14',
          world: { id: this.ids.worldId, title: 'W', system: 's', systemVersion: '1' },
          user: { id: this.ids.userId, name: 'Agent', role: 1, isGM: false },
          ...(this.headless ? { headless: true } : {}),
          auth:
            'code' in auth
              ? { kind: 'pairingCode', code: auth.code }
              : { kind: 'pairingToken', token: auth.token },
        }),
      ),
    );
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as { type: string; id?: string; pairingToken?: string };
      if (m.type === 'welcome') {
        if (m.pairingToken) this.store.token = m.pairingToken;
        ws.send(
          JSON.stringify({ type: 'toolset', eventReadAllowed: false, tools: coreAnnouncements() }),
        );
      } else if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      else if (m.type === 'call')
        ws.send(
          JSON.stringify({
            type: 'result',
            ok: true,
            id: m.id,
            text: 'world info',
            structured: { userName: 'Agent' },
          }),
        );
    });
  }

  close(): void {
    this.ws?.terminate();
  }
}

export interface FakeBrowserOptions {
  ids: FakeWorldIds;
  /** The page says it is headless in hello, like the real module with the session flag. */
  headlessFlag?: boolean;
}

/** A fake launcher: storage persists per profile dir, like a real Chromium profile. */
export class FakeLauncher implements BrowserLauncher {
  readonly launches: LaunchRequest[] = [];
  readonly navigations: string[] = [];
  readonly typedCodes: string[] = [];
  readonly evaluated: string[] = [];
  closes = 0;
  /** When set, `waitForGameReady` rejects with it. */
  failJoin: Error | undefined;
  /** When set, a typed code is never sent on: the agent stays unpaired. */
  noPair = false;
  private readonly profiles = new Map<string, { token?: string }>();
  private readonly open = new Set<PageModule>();

  constructor(private readonly o: FakeBrowserOptions) {}

  tokenOf(profileDir: string): string | undefined {
    return this.profiles.get(profileDir)?.token;
  }

  async launch(req: LaunchRequest): Promise<RunnerBrowser> {
    this.launches.push(req);
    const store = this.profiles.get(req.profileDir) ?? {};
    this.profiles.set(req.profileDir, store);
    const mod = new PageModule(this.o.ids, store, this.o.headlessFlag ?? true);
    this.open.add(mod);
    let url = 'about:blank';
    const page: RunnerPage = {
      goto: async (u) => {
        this.navigations.push(u);
        url = u;
      },
      url: () => url,
      waitForSelector: async () => undefined,
      selectOption: async () => undefined,
      fill: async (selector, value) => {
        if (selector === SELECTORS.pairingCode) this.typedCodes.push(value);
      },
      click: async (selector) => {
        if (selector === SELECTORS.pairingSubmit) {
          const code = this.typedCodes.at(-1);
          if (code && !this.noPair) mod.connect({ code });
        }
      },
      evaluate: async (script) => void this.evaluated.push(script),
      waitForGameReady: async () => {
        if (this.failJoin) throw this.failJoin;
        // The module reads its stored token once the game is ready.
        if (store.token) mod.connect({ token: store.token });
      },
    };
    return {
      page,
      close: async () => {
        this.closes++;
        mod.close();
        this.open.delete(mod);
      },
    };
  }
}
