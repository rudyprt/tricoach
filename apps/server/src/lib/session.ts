import type { Session } from "@prisma/client";

export interface SessionExercise {
  repetitions: string;
  allure: string;
  recuperation?: string;
}

export interface SessionBlock {
  dureeMin: number;
  cible: string;
  description: string;
  exercices?: SessionExercise[];
}

export interface SessionStructure {
  echauffement: SessionBlock;
  corps: SessionBlock;
  retourCalme: SessionBlock;
}

export function serializeSession(session: Session) {
  let structure: SessionStructure | null = null;
  if (session.structure) {
    try {
      structure = JSON.parse(session.structure) as SessionStructure;
    } catch {
      structure = null;
    }
  }
  return { ...session, structure };
}
