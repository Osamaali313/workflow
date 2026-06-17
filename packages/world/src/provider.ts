import { z } from 'zod/v4';
import type { World } from './interfaces.js';

type WorldFactory = () => World | Promise<World>;

export const WorldProviderSchema = z.strictObject({
  type: z.literal('world-provider'),
  create: z.custom<WorldFactory>((value) => typeof value === 'function'),
});

export type WorldProvider = z.infer<typeof WorldProviderSchema>;

export function defineWorldProvider(create: WorldFactory): WorldProvider {
  return { type: 'world-provider', create };
}
