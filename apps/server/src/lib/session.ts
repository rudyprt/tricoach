import { z } from "zod";
import type { Session } from "@prisma/client";

export const sessionExerciseSchema = z.object({
  repetitions: z.string(),
  allure: z.string(),
  recuperation: z.string().optional(),
});

export const sessionBlockSchema = z.object({
  dureeMin: z.number(),
  cible: z.string(),
  description: z.string(),
  exercices: z.array(sessionExerciseSchema).optional(),
});

export const sessionStructureSchema = z.object({
  echauffement: sessionBlockSchema,
  corps: sessionBlockSchema,
  retourCalme: sessionBlockSchema,
});

export type SessionExercise = z.infer<typeof sessionExerciseSchema>;
export type SessionBlock = z.infer<typeof sessionBlockSchema>;
export type SessionStructure = z.infer<typeof sessionStructureSchema>;

/**
 * `structure` est une colonne JSONB : elle peut contenir n'importe quelle forme
 * si un ancien enregistrement est incomplet. On la valide avant de l'exposer,
 * pour que le client n'ait jamais à se défendre contre une structure partielle.
 */
export function serializeSession(session: Session) {
  const parsed = session.structure ? sessionStructureSchema.safeParse(session.structure) : null;
  return { ...session, structure: parsed?.success ? parsed.data : null };
}
