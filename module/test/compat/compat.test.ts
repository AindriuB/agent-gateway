import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  foundryGeneration,
  fromUuidCompat,
  getApplicationV2,
  getHandlebarsApplicationMixin,
  hasSceneLevels,
} from '../../src/compat/index.js';
import { installFoundry, type FoundryStub, type Generation } from '../stubs/foundry.js';

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

describe.each([13, 14] as Generation[])('compat on v%i', (gen) => {
  it('reports generation', () => {
    stub = installFoundry(gen);
    expect(foundryGeneration()).toBe(gen);
  });
  it('hasSceneLevels only on v14', () => {
    stub = installFoundry(gen);
    expect(hasSceneLevels()).toBe(gen === 14);
  });
  it('hasSceneLevels false on v14 without the feature', () => {
    stub = installFoundry(gen, { sceneLevels: false });
    expect(hasSceneLevels()).toBe(false);
  });
  it('exposes ApplicationV2 and mixin', () => {
    stub = installFoundry(gen);
    expect(typeof getApplicationV2()).toBe('function');
    expect(typeof getHandlebarsApplicationMixin()).toBe('function');
  });
  it('wraps fromUuid', async () => {
    stub = installFoundry(gen);
    expect(await fromUuidCompat('Actor.x')).toEqual({ uuid: 'Actor.x' });
  });
});

describe('isolation', () => {
  it('no file under module/src other than compat reads game.release', () => {
    const root = resolve(__dirname, '../../src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (
          /game\??\.release/.test(readFileSync(p, 'utf8')) &&
          !p.includes(`${join('src', 'compat')}`)
        )
          offenders.push(p);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
