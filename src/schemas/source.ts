import { z } from 'zod';

export const sourceSchema = z.object({
  name: z.string().trim().min(1, 'Informe um nome').max(120, 'Máximo de 120 caracteres'),
  source_type: z.enum(['group', 'customer_list', 'authorized_list', 'form', 'manual', 'other']),
  description: z.string().trim().max(500, 'Máximo de 500 caracteres').optional().nullable(),
});
export type SourceForm = z.infer<typeof sourceSchema>;
