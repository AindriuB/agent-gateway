/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerSettings, settingRegistrars } from '../../src/settings/index.js';
import { installFoundry, type FoundryStub, type Generation } from '../stubs/foundry.js';

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

const lang = JSON.parse(readFileSync(resolve(__dirname, '../../../lang/en.json'), 'utf8'));
const resolveKey = (key: string) => key.split('.').reduce((o: any, k) => o?.[k], lang);

describe.each([13, 14] as Generation[])('settings on v%i', (gen) => {
  it('registers foundation settings with correct scope', () => {
    stub = installFoundry(gen);
    registerSettings();
    const s = stub.registeredSettings;
    expect(s.get('agent-gateway.gatewayUrl')).toMatchObject({ scope: 'client', config: true });
    expect(s.get('agent-gateway.pairingToken')).toMatchObject({ scope: 'client', config: false });
    expect(s.get('agent-gateway.includeOtherModuleData')).toMatchObject({
      scope: 'world',
      restricted: true,
      default: false,
    });
  });
  it('names and hints are AGENT_GATEWAY.Settings keys present in lang', () => {
    stub = installFoundry(gen);
    registerSettings();
    for (const cfg of stub.registeredSettings.values()) {
      for (const key of [cfg.name, cfg.hint!]) {
        expect(key).toMatch(/^AGENT_GATEWAY\.Settings\./);
        expect(typeof resolveKey(key)).toBe('string');
      }
    }
  });
});

it('one failing registrar does not abort the others', () => {
  stub = installFoundry(14);
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  settingRegistrars.unshift(() => {
    throw new Error('boom');
  });
  try {
    registerSettings();
  } finally {
    settingRegistrars.shift();
    spy.mockRestore();
  }
  expect(stub.registeredSettings.has('agent-gateway.gatewayUrl')).toBe(true);
  expect(stub.registeredMenus.has('agent-gateway.pairing')).toBe(true);
});
