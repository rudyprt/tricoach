import type Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma.js";
import { addDays, localCalendarDate } from "./week.js";
import { consentementSante } from "./consentSante.js";

/**
 * Une séance racontée au coach dans le chat.
 *
 * L'athlète dit « j'ai fait ma sortie longue hier, 1h40, j'étais bien » et
 * l'information se perdait dans le fil : elle ne comptait ni dans l'historique,
 * ni dans la charge, ni dans la semaine suivante — qui se construit pourtant
 * sur ce qui a été réalisé. Il fallait aller la ressaisir ailleurs, et personne
 * ne le fait.
 *
 * Le coach dispose donc d'un outil pour l'enregistrer au moment où elle est
 * dite. Ce n'est pas une mesure : c'est une déclaration, moins fiable qu'un
 * fichier de montre, et l'athlète doit pouvoir la corriger comme n'importe
 * quelle séance.
 */

export const SPORTS_DECLARABLES = ["natation", "velo", "course", "renfo"] as const;

/** Au-delà, c'est un souvenir : la charge récente ne s'en trouve plus changée. */
export const FENETRE_DECLARATION_JOURS = 14;

export const NOM_OUTIL_SEANCE = "enregistrer_seance";

const LIBELLE_SPORT: Record<(typeof SPORTS_DECLARABLES)[number], string> = {
  natation: "Natation",
  velo: "Vélo",
  course: "Course",
  renfo: "Renforcement",
};

export const outilSeanceFaite: Anthropic.Tool = {
  name: NOM_OUTIL_SEANCE,
  description:
    "Enregistre dans l'historique une séance que l'athlète dit avoir faite. " +
    "À utiliser dès qu'il raconte un entraînement au passé, même brièvement " +
    "(« j'ai couru 45 min ce matin », « sortie vélo hier, 2h »). " +
    "N'appelle pas cet outil pour une séance à venir, pour une séance qu'il " +
    "dit avoir manquée, ni quand il se contente de poser une question sur une " +
    "séance. En cas de doute sur la date ou la durée, demande-lui plutôt que " +
    "de deviner. La séance prévue ce jour-là est mise à jour ou remplacée par " +
    "celle-ci, jamais dupliquée : appelle l'outil une seule fois par séance.",
  input_schema: {
    type: "object",
    properties: {
      date: {
        type: "string",
        description: "Jour de la séance, au format AAAA-MM-JJ. Jamais dans le futur.",
      },
      sport: { type: "string", enum: [...SPORTS_DECLARABLES] },
      dureeMin: { type: "number", description: "Durée réelle en minutes." },
      distanceKm: { type: "number", description: "Distance en kilomètres, si l'athlète la donne." },
      ressenti: {
        type: "string",
        description: "Ce qu'il dit de ses sensations, en ses mots, en une phrase courte.",
      },
      titre: { type: "string", description: "Nom court de la séance, 40 caractères maximum." },
    },
    required: ["date", "sport", "dureeMin"],
  },
};

const entreeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sport: z.enum(SPORTS_DECLARABLES),
  dureeMin: z.number().int().positive().max(600),
  distanceKm: z.number().positive().max(500).optional(),
  ressenti: z.string().trim().max(200).optional(),
  titre: z.string().trim().max(40).optional(),
});

export interface ResultatDeclaration {
  /** Texte rendu au modèle : il doit pouvoir expliquer ce qui s'est passé. */
  message: string;
  /** Vrai quand l'historique a réellement changé. */
  enregistree: boolean;
}

/**
 * Enregistre la séance déclarée, sans jamais doubler une séance du jour.
 *
 * L'athlète raconte le plus souvent ce que son coach lui avait demandé, ou ce
 * qu'il a fait à la place. Ajouter une séance à côté laissait deux, parfois
 * trois séances le même jour : celle du programme, toujours « à faire », et
 * celle racontée — ou la même racontée deux fois. Dans l'ordre :
 *
 * 1. une séance du même sport ce jour-là est mise à jour (déjà faite : corrigée
 *    plutôt que dupliquée ; prévue ou manquée : marquée faite) ;
 * 2. sinon, la séance prévue ce jour-là est remplacée par celle réellement
 *    faite — y compris un jour de repos. Avec plusieurs séances prévues, celle
 *    dont la durée est la plus proche ;
 * 3. sinon seulement, une séance est ajoutée à la semaine correspondante — à
 *    condition qu'un programme la couvre.
 */
export async function enregistrerSeanceDeclaree(
  userId: string,
  entree: unknown,
  timezone: string
): Promise<ResultatDeclaration> {
  const parsed = entreeSchema.safeParse(entree);
  if (!parsed.success) {
    return {
      message: "Données incomplètes ou invalides : demande à l'athlète de préciser la date, le sport et la durée.",
      enregistree: false,
    };
  }
  const { date, sport, dureeMin, distanceKm, titre } = parsed.data;
  // Le ressenti est une donnée de santé : sans consentement, il n'est pas gardé.
  const ressenti = parsed.data.ressenti && (await consentementSante(userId)) ? parsed.data.ressenti : undefined;

  const aujourdHui = localCalendarDate(new Date(), timezone);
  if (date > aujourdHui) {
    return { message: "Cette date est dans le futur : une séance ne s'enregistre qu'une fois faite.", enregistree: false };
  }
  const limite = localCalendarDate(addDays(new Date(), -FENETRE_DECLARATION_JOURS), timezone);
  if (date < limite) {
    return {
      message: `Cette séance date de plus de ${FENETRE_DECLARATION_JOURS} jours : trop ancienne pour être ajoutée à l'historique.`,
      enregistree: false,
    };
  }

  const jour = new Date(`${date}T00:00:00.000Z`);
  const lendemain = addDays(jour, 1);
  const duJour = await prisma.session.findMany({
    where: { userId, date: { gte: jour, lt: lendemain } },
    orderBy: { date: "asc" },
  });

  const realise = {
    status: "faite",
    dureeReelleMin: dureeMin,
    ...(distanceKm ? { distanceKm } : {}),
    ...(ressenti ? { ressenti } : {}),
    completedAt: new Date(),
  };

  // 1. Même sport ce jour-là : la séance prévue de préférence, sinon celle déjà
  //    enregistrée (la même séance racontée une seconde fois).
  const memeSport =
    duJour.find((s) => s.sport === sport && s.status !== "faite") ?? duJour.find((s) => s.sport === sport);
  if (memeSport) {
    const dejaFaite = memeSport.status === "faite";
    await prisma.session.update({ where: { id: memeSport.id }, data: realise });
    return {
      message: dejaFaite
        ? `La séance du ${date} (${sport}) était déjà enregistrée : elle a été mise à jour (${dureeMin} min), pas dupliquée.`
        : `Séance du ${date} (${sport}) marquée comme faite, ${dureeMin} min. Elle était déjà au programme.`,
      enregistree: true,
    };
  }

  // 2. Une autre séance était prévue ce jour-là (ou c'était un jour de repos) :
  //    l'athlète a fait autre chose à la place, la séance prévue est remplacée.
  const prevues = duJour.filter((s) => s.status !== "faite");
  const remplacee = prevues.sort((a, b) => Math.abs(a.dureeMin - dureeMin) - Math.abs(b.dureeMin - dureeMin))[0];
  if (remplacee) {
    await prisma.session.update({
      where: { id: remplacee.id },
      data: {
        ...realise,
        sport,
        titre: titre || `${LIBELLE_SPORT[sport]} libre`,
        dureeMin,
        distanceKm: distanceKm ?? null,
        description: `Séance déclarée au coach dans le chat, à la place de « ${remplacee.titre} ».`,
        objectif: null,
        structure: Prisma.DbNull,
      },
    });
    return {
      message: `Séance du ${date} (${sport}, ${dureeMin} min) enregistrée à la place de « ${remplacee.titre} » qui était prévue ce jour-là. Dis-le à l'athlète.`,
      enregistree: true,
    };
  }

  // Une séance appartient à un programme : sans programme couvrant cette date,
  // il n'y a nulle part où la ranger.
  const plan = await prisma.trainingPlan.findFirst({
    where: { userId, weekStart: { lte: jour, gt: addDays(jour, -7) } },
    orderBy: { weekStart: "desc" },
  });
  if (!plan) {
    return {
      message: `Aucun programme ne couvre le ${date} : la séance n'a pas pu être ajoutée à l'historique. Dis-le à l'athlète.`,
      enregistree: false,
    };
  }

  await prisma.session.create({
    data: {
      planId: plan.id,
      userId,
      date: jour,
      sport,
      titre: titre || `${LIBELLE_SPORT[sport]} libre`,
      dureeMin,
      dureeReelleMin: dureeMin,
      distanceKm: distanceKm ?? null,
      description: "Séance déclarée au coach dans le chat.",
      status: "faite",
      ...(ressenti ? { ressenti } : {}),
      completedAt: new Date(),
    },
  });

  return {
    message: `Séance du ${date} (${sport}, ${dureeMin} min) ajoutée à l'historique. Elle n'était pas au programme.`,
    enregistree: true,
  };
}
