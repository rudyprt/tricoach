import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "./prisma.js";
import { localCalendarDate } from "./week.js";

/**
 * Ce que l'athlète demande au coach pour ses programmes.
 *
 * « Je veux le renfo le lundi » se disait dans le chat, le coach acquiesçait,
 * et la semaine suivante plaçait le renfo le jeudi : la génération ne lit pas
 * le fil de discussion. Le coach retient désormais ces demandes dans une liste
 * courte, relue à chaque génération, que l'athlète peut consulter et effacer.
 */

/** Au-delà, la liste cesse d'être lue comme des consignes et devient du bruit. */
export const MAX_CONSIGNES = 15;

export const NOM_OUTIL_RETENIR = "retenir_consigne";
export const NOM_OUTIL_OUBLIER = "oublier_consigne";

export const outilRetenirConsigne: Anthropic.Tool = {
  name: NOM_OUTIL_RETENIR,
  description:
    "Retient une demande de l'athlète sur la construction de ses programmes, pour l'appliquer à toutes les semaines générées ensuite : " +
    "jour ou moment d'une discipline (« renfo le lundi », « sortie longue le dimanche »), séance à éviter ou à privilégier, " +
    "contrainte passagère (« en déplacement du 20 au 24, pas de vélo »). " +
    "Utilise-le dès que l'athlète exprime une telle demande, sans attendre qu'il te le demande explicitement. " +
    "Ne l'utilise pas pour une question, une séance déjà faite ou une information ponctuelle sans effet sur le programme.",
  input_schema: {
    type: "object",
    properties: {
      texte: {
        type: "string",
        description: "La consigne, reformulée en une phrase courte et sans ambiguïté, ex : « Placer la séance de renforcement le lundi. »",
      },
      jusquAu: {
        type: "string",
        description: "Dernier jour de validité (AAAA-MM-JJ) pour une consigne temporaire. À omettre pour une consigne permanente.",
      },
    },
    required: ["texte"],
  },
};

export const outilOublierConsigne: Anthropic.Tool = {
  name: NOM_OUTIL_OUBLIER,
  description:
    "Supprime une consigne retenue, quand l'athlète la retire ou la remplace (« finalement le renfo plutôt le mardi » : oublie l'ancienne, puis retiens la nouvelle).",
  input_schema: {
    type: "object",
    properties: { id: { type: "string", description: "Identifiant de la consigne, tel qu'il figure dans la liste." } },
    required: ["id"],
  },
};

const retenirSchema = z.object({
  texte: z.string().trim().min(3).max(200),
  jusquAu: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export interface ResultatConsigne {
  message: string;
  modifiee: boolean;
}

export interface Consigne {
  id: string;
  texte: string;
  jusquAu: Date | null;
}

/** Consignes en vigueur : permanentes, ou temporaires pas encore échues. */
export async function consignesActives(userId: string, timezone: string): Promise<Consigne[]> {
  const aujourdHui = new Date(`${localCalendarDate(new Date(), timezone)}T00:00:00.000Z`);
  return prisma.consigneCoach.findMany({
    where: { userId, OR: [{ jusquAu: null }, { jusquAu: { gte: aujourdHui } }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, texte: true, jusquAu: true },
  });
}

export async function retenirConsigne(userId: string, entree: unknown, timezone: string): Promise<ResultatConsigne> {
  const parsed = retenirSchema.safeParse(entree);
  if (!parsed.success) {
    return { message: "Consigne vide ou trop longue : reformule-la en une phrase courte.", modifiee: false };
  }
  const { texte, jusquAu } = parsed.data;
  if (jusquAu && jusquAu < localCalendarDate(new Date(), timezone)) {
    return { message: "Cette date est déjà passée : la consigne ne s'appliquerait à aucune semaine.", modifiee: false };
  }
  if ((await consignesActives(userId, timezone)).length >= MAX_CONSIGNES) {
    return {
      message: `L'athlète a déjà ${MAX_CONSIGNES} consignes : demande-lui laquelle retirer avant d'en ajouter une.`,
      modifiee: false,
    };
  }
  await prisma.consigneCoach.create({
    data: { userId, texte, jusquAu: jusquAu ? new Date(`${jusquAu}T00:00:00.000Z`) : null },
  });
  return {
    message: "Consigne retenue. Elle s'appliquera à chaque semaine générée à partir de maintenant ; pour la semaine en cours, l'athlète peut utiliser « Réajuster ma semaine ».",
    modifiee: true,
  };
}

export async function oublierConsigne(userId: string, entree: unknown): Promise<ResultatConsigne> {
  const id = typeof entree === "object" && entree && "id" in entree ? String((entree as { id: unknown }).id) : "";
  // Filtre par athlète : un identifiant d'un autre compte ne supprime rien.
  const { count } = await prisma.consigneCoach.deleteMany({ where: { id, userId } });
  return count
    ? { message: "Consigne supprimée.", modifiee: true }
    : { message: "Aucune consigne ne porte cet identifiant.", modifiee: false };
}

/** Pour le chat : la liste avec ses identifiants, que le coach peut retirer. */
export function consignesChatLines(consignes: Consigne[]): string[] {
  return consignes.length
    ? [
        "Consignes que tu as déjà retenues pour ses programmes (identifiant entre crochets) :",
        ...consignes.map((c) => `- [${c.id}] ${c.texte}${c.jusquAu ? ` (jusqu'au ${c.jusquAu.toISOString().slice(0, 10)})` : ""}`),
      ]
    : ["Aucune consigne retenue pour ses programmes pour le moment."];
}

/** Pour la génération : ce que l'athlète a demandé, à appliquer. */
export function consignesPromptLines(consignes: Consigne[]): string[] {
  if (consignes.length === 0) return [];
  return [
    "",
    "CONSIGNES DONNÉES PAR L'ATHLÈTE À SON COACH (dans le chat) — respecte-les dans la semaine que tu construis :",
    ...consignes.map((c) => `- ${c.texte}${c.jusquAu ? ` (valable jusqu'au ${c.jusquAu.toISOString().slice(0, 10)})` : ""}`),
    "Elles cèdent seulement devant la sécurité : le volume maximum, les jours déclarés indisponibles et une interruption d'entraînement l'emportent. Si tu ne peux pas en respecter une, dis pourquoi dans l'objectif de la séance concernée.",
  ];
}
