import { z } from "zod";

export const SectionFileSchema = z.object({
  id: z.number(),
  filename: z.string(),
  path: z.string(),
  content: z.string()
});

export type SectionFile = z.infer<typeof SectionFileSchema>;

export type DiffItem = {type: 'unchanged' | 'added' | 'removed', text: string};
