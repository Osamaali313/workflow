import { z } from 'zod/v4';
import type { World } from './interfaces.js';

export type ProviderValue<T> = T | (() => T);

type WorldFactory = () => World | Promise<World>;

export const WorldProviderSchema = z.strictObject({
  type: z.literal('world-provider'),
  id: z.string().trim().min(1),
  create: z.custom<WorldFactory>((value) => typeof value === 'function'),
});

export type WorldProvider = z.infer<typeof WorldProviderSchema>;

export function defineWorldProvider(
  provider: Omit<WorldProvider, 'type'>
): WorldProvider {
  return WorldProviderSchema.parse({
    type: 'world-provider',
    ...provider,
  });
}

export function resolveProviderValue<T>(value: ProviderValue<T>): T {
  return typeof value === 'function' ? (value as () => T)() : value;
}
