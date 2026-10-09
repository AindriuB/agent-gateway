#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

if (process.argv.includes('--version')) {
  console.log(pkg.version);
}
