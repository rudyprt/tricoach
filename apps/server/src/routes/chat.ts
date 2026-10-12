import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { askClaude, isAiConfigured, AiNotConfiguredError, type ClaudeMessage } from "../lib/anthropic.js";
import { MAX_TOKENS, MODELE_CHAT } from "../lib/modeles.js";
import { resumeAthlete } from "../lib/resumeAthlete.js";
import { mettreAJourResume, resumePromptLines } from "../lib/resumeChat.js";
import type Anthropic from "@anthropic-ai/sdk";
import { NOM_OUTIL_SEANCE, enregistrerSeanceDeclaree, outilSeanceFaite } from "../lib/seanceDeclaree.js";
import {
  NOM_OUTIL_OUBLIER,
  NOM_OUTIL_RETENIR,
  consignesActives,
  consignesChatLines,
  oublierConsigne,
  outilOublierConsigne,
  outilRetenirConsigne,
  retenirConsigne,
} from "../lib/consignesCoach.js";
import { recordAiCall } from "../lib/aiUsage.js";
import { FUSEAU_QUOTA, hasStandardAccess, quotaChatQuotidien } from "../lib/subscription.js";
import { FENETRE_CHAT, fenetreHistorique } from "../lib/chatHistory.js";
import { ah, HttpError } from "../lib/http.js";
import { chatRateLimit } from "../lib/rateLimit.js";
import { startOfLocalDay, startOfWeek } from "../lib/week.js";
import { bilanDeCharge } from "../lib/trainingLoad.js";
import { coursesDeLAthlete, coursesPromptLines } from "../lib/races.js";
import { pauseEnCours } from "../lib/pause.js";
import {
  disponibilitesPromptLines,
  materielPromptLines,
  parseDisponibilites,
  parseMateriel,
} from "../lib/disponibilites.js";
import { computeTrainingZones, formatZonesForPrompt, periodization } from "../lib/training.js";
import { buildZoneInputs } from "../lib/zoneInputs.js";

export const chatRouter = Router();
chatRouter.use(requireAuth);

/**
 * Consignes du coach, les mêmes pour tous les athlètes : elles sont mises en
 * cache avec les outils. Tout ce qui est propre à l'athlète arrive après, dans
 * le contexte.
 */
export const CONSIGNES_CHAT = [
  "Tu es le coach de triathlon personnel de cet athlète, dans un chat continu. Réponds en français, de façon concise, concrète et bienveillante.",
  "Séance racontée par l'athlète : enregistre-la avec enregistrer_seance (s'il manque la date ou la durée, demande-les d'abord), puis dis-lui en une phrase que c'est noté dans son historique.",
  "Demande sur la construction de ses programmes (jour d'une discipline, séance à éviter, contrainte passagère) : retiens-la avec retenir_consigne, puis dis-lui qu'elle s'appliquera dès la prochaine semaine générée, et que « Réajuster ma semaine » l'applique à la semaine en cours. S'il la retire ou la remplace, supprime l'ancienne avec oublier_consigne.",
  "Le contexte ci-dessous résume son profil, son entraînement et vos échanges précédents. Reprends ses zones telles quelles, sans les recalculer. Tiens compte de sa fatigue et de ses jours indisponibles avant de proposer une séance.",
  "Interruption en cours : ne propose aucune séance tant qu'il n'a pas repris ; parle récupération, et invite-le à consulter si c'est une blessure qui dure.",
  "Test de terrain programmé : s'il t'interroge dessus, explique le protocole et rappelle qu'il sert à recaler ses zones.",
].join("\n");

/**
 * Compte les questions posées aujourd'hui, au sens du fuseau de référence.
 *
 * Seuls les messages de l'athlète comptent : une réponse du coach ne doit pas
 * amputer son quota.
 */
interface EtatQuota {
  utilises: number;
  limite: number;
  /** Ce qui empêche d'écrire, s'il y a lieu. Deux impasses très différentes. */
  bloque: "quota" | "abonnement" | null;
}

function etatDuQuota(user: { plan: string; createdAt: Date } | null, utilises: number): EtatQuota {
  const compte = user ?? { plan: "free", createdAt: new Date() };
  const limite = quotaChatQuotidien(compte);
  const bloque = !hasStandardAccess(compte) ? "abonnement" : utilises >= limite ? "quota" : null;
  return { utilises, limite, bloque };
}

async function messagesDuJour(userId: string): Promise<number> {
  return prisma.chatMessage.count({
    where: {
      userId,
      role: "user",
      createdAt: { gte: startOfLocalDay(new Date(), FUSEAU_QUOTA) },
    },
  });
}

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Date du plus ancien message déjà affiché, pour remonter le fil. */
  before: z.string().datetime().optional(),
});

/**
 * Le fil est renvoyé par tranches, du plus récent au plus ancien puis remis
 * dans l'ordre : une conversation de plusieurs centaines de messages ne doit
 * pas être rechargée entièrement à chaque ouverture.
 */
chatRouter.get(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const parsed = historyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, "Paramètres de conversation invalides.");
    }
    const { limit, before } = parsed.data;

    const [recent, user, utilises] = await Promise.all([
      prisma.chatMessage.findMany({
        where: {
          userId: req.userId!,
          ...(before ? { createdAt: { lt: new Date(before) } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
      }),
      prisma.user.findUnique({ where: { id: req.userId! }, select: { plan: true, createdAt: true } }),
      messagesDuJour(req.userId!),
    ]);

    const hasMore = recent.length > limit;
    const page = hasMore ? recent.slice(0, limit) : recent;

    res.json({
      messages: page.reverse(),
      hasMore,
      oldestAt: page[0]?.createdAt ?? null,
      // Le quota est calculé ici et non dans le navigateur : celui-ci ignore le
      // fuseau de référence comme l'offre, et affichait un reste que le serveur
      // refusait. Le motif du blocage vient d'ici pour la même raison : attendre
      // minuit ne débloque pas un essai terminé, et l'inverse non plus.
      quota: etatDuQuota(user, utilises),
    });
  })
);

chatRouter.delete(
  "/",
  ah(async (req: AuthedRequest, res) => {
    await prisma.chatMessage.deleteMany({ where: { userId: req.userId! } });
    res.json({ ok: true });
  })
);

const sendSchema = z.object({
  content: z.string().trim().min(1, "Message vide.").max(4000, "Message trop long (4000 caractères maximum)."),
});

chatRouter.post(
  "/",
  chatRateLimit,
  ah(async (req: AuthedRequest, res) => {
    if (!isAiConfigured()) {
      throw new HttpError(503, new AiNotConfiguredError().message);
    }

    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Message invalide." });
      return;
    }
    const content = parsed.data.content;

    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { plan: true, timezone: true, createdAt: true },
    });
    if (!user) {
      throw new HttpError(404, "Utilisateur introuvable.");
    }

    // Le chat se payait tout seul : la génération de programme refusait un essai
    // expiré, mais pas lui. Un compte abandonné après l'essai pouvait donc
    // continuer à appeler le modèle indéfiniment, sans rien payer.
    if (!hasStandardAccess(user)) {
      throw new HttpError(
        402,
        "Votre période d'essai gratuite est terminée. Choisissez une offre pour continuer à échanger avec le coach.",
        "SUBSCRIPTION_REQUIRED"
      );
    }

    // Le plafond est vérifié ici, et pas seulement dans l'interface : un bouton
    // grisé n'empêche personne d'appeler la route directement, et c'est bien
    // l'appel au modèle qui coûte.
    const limite = quotaChatQuotidien(user);
    if ((await messagesDuJour(req.userId!)) >= limite) {
      throw new HttpError(
        429,
        "Vous avez atteint votre limite de messages pour aujourd'hui. Elle se réinitialise à minuit, heure de Paris.",
        "CHAT_QUOTA_REACHED"
      );
    }

    const [profile, recentMessages, resume] = await Promise.all([
      prisma.athleteProfile.findUnique({ where: { userId: req.userId! } }),
      // Les DERNIERS messages, pas les premiers : trié en ascendant, `take` renvoyait
      // les plus anciens et le coach perdait le fil au bout de quelques échanges.
      prisma.chatMessage.findMany({
        where: { userId: req.userId! },
        orderBy: { createdAt: "desc" },
        take: FENETRE_CHAT,
      }),
      prisma.resumeChat.findUnique({ where: { userId: req.userId! }, select: { texte: true, jusquA: true } }),
    ]);

    const history = [...recentMessages].reverse();

    const zones = profile ? computeTrainingZones(await buildZoneInputs(req.userId!, profile)) : null;
    const phase = profile ? periodization(new Date(), profile.objectifDate) : null;

    // Le coach du chat voyait moins de choses que celui qui construit la
    // semaine : il pouvait répondre « repose-toi si tu le sens » à un athlète
    // dont la surcharge est déjà mesurée, ou proposer une séance un jour où
    // l'athlète a déclaré être indisponible.
    const semaine = startOfWeek(new Date(), user.timezone);
    const [charge, courses, interruption, testsEnCours, consignes] = await Promise.all([
      bilanDeCharge(req.userId!),
      coursesDeLAthlete(req.userId!, semaine),
      pauseEnCours(req.userId!),
      prisma.fitnessTest.findMany({
        where: { userId: req.userId!, status: "planifie" },
        orderBy: { scheduledFor: "asc" },
        take: 3,
      }),
      consignesActives(req.userId!, user.timezone),
    ]);

    // Ce qui change d'un athlète et d'une question à l'autre. Les séances n'y
    // figurent plus une à une : un résumé calculé en dit l'essentiel.
    const contexte = [
      ...resumePromptLines(resume),
      profile
        ? await resumeAthlete(req.userId!, { profil: profile, charge })
        : "L'athlète n'a pas encore rempli son profil.",
      phase ? `Phase : ${phase.label}, objectif dans ${phase.weeksToGoal} sem. ${phase.guidance}` : "",
      zones ? `Zones :\n${formatZonesForPrompt(zones)}` : "",
      ...coursesPromptLines(courses, semaine),
      ...disponibilitesPromptLines(parseDisponibilites(profile?.disponibilites), semaine),
      ...materielPromptLines(parseMateriel(profile?.materiel)),
      interruption
        ? `INTERRUPTION EN COURS : ${interruption.raison}${interruption.detail ? ` — « ${interruption.detail} »` : ""}, depuis le ${interruption.debut.toISOString().slice(0, 10)}.`
        : "",
      testsEnCours.length
        ? `Test de terrain programmé : ${testsEnCours
            .map((t) => `${t.kind} le ${t.scheduledFor.toISOString().slice(0, 10)}`)
            .join(", ")}.`
        : "",
      ...consignesChatLines(consignes),
    ]
      .filter(Boolean)
      .join("\n");

    let reply: string;
    let seancesEnregistrees = 0;
    let consignesModifiees = false;
    const outils = [outilSeanceFaite, outilRetenirConsigne, outilOublierConsigne];
    let resumeAJour: Promise<void> = Promise.resolve();
    try {
      const messages: ClaudeMessage[] = fenetreHistorique([
        ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user", content },
      ]);

      // Le résumé rattrape les messages sortis de la fenêtre pendant que le
      // coach répond : il servira aux questions suivantes, pas à celle-ci.
      resumeAJour = mettreAJourResume(req.userId!, resume, history[0]?.createdAt ?? null);
      const response = await askClaude({
        modele: MODELE_CHAT,
        etiquette: "chat",
        system: CONSIGNES_CHAT,
        contexte,
        messages,
        maxTokens: MAX_TOKENS.chat,
        tools: outils,
      });
      reply = response.text;
      await recordAiCall({ userId: req.userId!, kind: "chat", response, succeeded: true });

      /*
       * Le modèle demande d'enregistrer une séance : on l'exécute, puis on lui
       * rend la main pour qu'il réponde à l'athlète en connaissance du
       * résultat. Un second appel, mais seulement quand une séance est
       * réellement déclarée — pas à chaque message.
       */
      if (response.toolUses.length > 0) {
        const resultats: Anthropic.ToolResultBlockParam[] = [];
        for (const appel of response.toolUses) {
          let resultat: { message: string };
          if (appel.name === NOM_OUTIL_SEANCE) {
            const r = await enregistrerSeanceDeclaree(req.userId!, appel.input, user.timezone);
            if (r.enregistree) seancesEnregistrees += 1;
            resultat = r;
          } else if (appel.name === NOM_OUTIL_RETENIR || appel.name === NOM_OUTIL_OUBLIER) {
            const r =
              appel.name === NOM_OUTIL_RETENIR
                ? await retenirConsigne(req.userId!, appel.input, user.timezone)
                : await oublierConsigne(req.userId!, appel.input);
            if (r.modifiee) consignesModifiees = true;
            resultat = r;
          } else {
            resultat = { message: "Outil inconnu." };
          }
          resultats.push({ type: "tool_result", tool_use_id: appel.id, content: resultat.message });
        }

        const suite = await askClaude({
          modele: MODELE_CHAT,
          etiquette: "chat_outil",
          system: CONSIGNES_CHAT,
          contexte,
          messages: [
            ...messages,
            { role: "assistant", content: response.content },
            { role: "user", content: resultats },
          ],
          maxTokens: MAX_TOKENS.chat,
          tools: outils,
        });
        reply = suite.text;
        await recordAiCall({ userId: req.userId!, kind: "chat", response: suite, succeeded: Boolean(reply.trim()) });
      }
    } catch (err) {
      await recordAiCall({ userId: req.userId!, kind: "chat", model: MODELE_CHAT, succeeded: false });
      console.error("Réponse du coach IA impossible :", err);
      throw new HttpError(502, "Le coach IA n'a pas pu répondre. Réessayez.");
    }

    await resumeAJour;
    if (!reply.trim()) {
      throw new HttpError(502, "Le coach IA n'a pas pu répondre. Réessayez.");
    }

    // Les deux messages sont enregistrés ensemble, après la réponse : en cas
    // d'échec, la question n'est pas conservée et ne consomme pas le quota.
    // Les horodatages sont explicites car, dans une même transaction, le
    // CURRENT_TIMESTAMP de Postgres est identique pour les deux lignes — le fil
    // serait alors trié dans un ordre arbitraire au rechargement.
    const askedAt = new Date();
    const [, saved] = await prisma.$transaction([
      prisma.chatMessage.create({
        data: { userId: req.userId!, role: "user", content, createdAt: askedAt },
      }),
      prisma.chatMessage.create({
        data: {
          userId: req.userId!,
          role: "assistant",
          content: reply,
          createdAt: new Date(askedAt.getTime() + 1),
        },
      }),
    ]);

    // L'interface doit pouvoir recharger la semaine : une séance vient d'y
    // passer en « faite » sans que l'athlète ait touché à l'écran.
    res.status(201).json({ ...saved, seancesEnregistrees, consignesModifiees });
  })
);
