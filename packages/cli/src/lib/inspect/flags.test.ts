import { Parser } from '@oclif/core';
import { expect, it } from 'vitest';
import { cliFlags } from './flags.js';

it('parses without an explicit backend', async () => {
  const { flags } = await Parser.parse([], { flags: cliFlags });

  expect(flags.backend).toBeUndefined();
  expect(flags.authToken).toBeUndefined();
  expect(flags.project).toBeUndefined();
  expect(flags.team).toBeUndefined();
});
