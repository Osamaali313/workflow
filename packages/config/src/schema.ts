import { QueueNamespaceSchema } from '@workflow/world/queue.js';
import { z } from 'zod/v4';

const sourcemapSchema = z.union([
  z.boolean(),
  z.enum(['inline', 'linked', 'external', 'both']),
]);
export type SourcemapMode = z.infer<typeof sourcemapSchema>;

const integrationSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('next'),
  }),
  z.strictObject({
    type: z.literal('nitro'),
    typescriptPlugin: z.boolean().optional(),
    runtime: z.string().min(1).optional(),
  }),
]);

export const WorkflowConfigSchema = z.strictObject({
  world: z.string().min(1).optional(),
  build: z
    .strictObject({
      dirs: z.array(z.string().min(1)).min(1).optional(),
      projectRoot: z.string().min(1).optional(),
      externalPackages: z.array(z.string().min(1)).optional(),
      sourcemap: sourcemapSchema.optional(),
      manifest: z
        .strictObject({
          public: z.boolean().optional(),
          output: z.string().min(1).optional(),
        })
        .optional(),
    })
    .optional(),
  queue: z
    .strictObject({
      namespace: QueueNamespaceSchema,
    })
    .optional(),
  integration: integrationSchema.optional(),
});

export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;
export type WorkflowIntegrationType =
  | NonNullable<WorkflowConfig['integration']>['type']
  | 'astro'
  | 'sveltekit';
