import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

/**
 * Consentement aux données de santé : blessures, douleurs, contraintes
 * physiques, ressentis après séance ou course, et motif médical d'une interruption.
 *
 * Il est distinct de l'acceptation des conditions : sans lui, ces données ne
 * sont pas enregistrées et le service reste utilisable. Il se retire depuis
 * « Mon compte », et le retrait efface ce qui avait déjà été enregistré : un
 * consentement retiré qui laisserait les données en place ne serait qu'un
 * mot.
 */

export async function consentementSante(userId: string): Promise<Date | null> {
  const profil = await prisma.athleteProfile.findUnique({ where: { userId }, select: { consentSanteAt: true } });
  return profil?.consentSanteAt ?? null;
}

/** Enregistre le consentement ; la date du premier accord est conservée. */
export async function donnerConsentementSante(userId: string): Promise<Date | null> {
  const actuel = await consentementSante(userId);
  if (actuel) return actuel;
  const { count } = await prisma.athleteProfile.updateMany({ where: { userId }, data: { consentSanteAt: new Date() } });
  return count > 0 ? consentementSante(userId) : null;
}

/**
 * Retire le consentement et efface, en une transaction, toutes les données de
 * santé du compte. Les interruptions restent (leurs dates règlent la reprise),
 * mais sans leur précision ni leur motif médical.
 */
export async function retirerConsentementSante(userId: string): Promise<{ ressentis: number; pauses: number }> {
  // Le ressenti d'une course est rangé dans son résultat, un objet JSON.
  const courses = await prisma.race.findMany({ where: { userId, resultat: { not: Prisma.DbNull } }, select: { id: true, resultat: true } });
  const coursesAvecRessenti = courses.filter((c) => {
    const r = c.resultat as { ressenti?: unknown } | null;
    return typeof r?.ressenti === "string" && r.ressenti.trim() !== "";
  });

  const [, ressentis, details, motifs] = await prisma.$transaction([
    prisma.athleteProfile.updateMany({ where: { userId }, data: { consentSanteAt: null, contraintes: "" } }),
    prisma.session.updateMany({ where: { userId, ressenti: { not: null } }, data: { ressenti: null } }),
    prisma.trainingPause.updateMany({ where: { userId, detail: { not: "" } }, data: { detail: "" } }),
    prisma.trainingPause.updateMany({
      where: { userId, raison: { in: ["blessure", "maladie"] } },
      data: { raison: "indisponibilite" },
    }),
    ...coursesAvecRessenti.map((c) =>
      prisma.race.update({
        where: { id: c.id },
        data: { resultat: { ...(c.resultat as Prisma.JsonObject), ressenti: "" } },
      })
    ),
  ]);
  return { ressentis: ressentis.count + coursesAvecRessenti.length, pauses: Math.max(details.count, motifs.count) };
}
