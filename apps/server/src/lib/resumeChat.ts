import { prisma } from "./prisma.js";
import { askClaude } from "./anthropic.js";
import { recordAiCall } from "./aiUsage.js";
import { MAX_TOKENS, MODELE_CHAT } from "./modeles.js";

/**
 * Le fil de la conversation, au-delà des derniers messages.
 *
 * Seuls les derniers échanges sont renvoyés au modèle à chaque question. Ce
 * qui s'est dit avant — une douleur signalée, une préférence, un conseil déjà
 * donné — n'est pas perdu pour autant : il tient dans un résumé de quelques
 * phrases, mis à jour par le modèle le moins coûteux à mesure que des messages
 * sortent de la fenêtre.
 */

/**
 * Messages sortis de la fenêtre qu'on laisse s'accumuler avant de mettre le
 * résumé à jour : deux échanges. Plus bas, on paierait un résumé à chaque
 * question ; plus haut, le coach oublierait trop longtemps ce qui vient d'en
 * sortir.
 */
export const SEUIL_RESUME = 4;

/** Au-delà, seuls les plus récents sont résumés : un très vieux fil n'a plus cours. */
const MAX_MESSAGES_RESUMES = 40;
const MAX_CARACTERES_MESSAGE = 600;

const CONSIGNES_RESUME = [
  "Tu tiens le résumé d'une conversation entre un triathlète et son coach.",
  "Mets à jour le résumé existant avec les nouveaux échanges. Garde seulement ce qui sert à la suite du coaching : objectifs et préférences exprimés, douleurs, fatigue ou contraintes signalées, conseils donnés et décisions prises, questions restées ouvertes. Oublie les politesses et ce qui est périmé.",
  "120 mots au maximum, en français, phrases courtes, à la troisième personne (« l'athlète »). Réponds uniquement par le résumé.",
].join("\n");

export interface ResumeConversation {
  texte: string;
  jusquA: Date;
}

export function resumePromptLines(resume: ResumeConversation | null): string[] {
  return resume ? [`Résumé de vos échanges précédents : ${resume.texte}`] : [];
}

/**
 * Résume les messages qui précèdent `debutFenetre` et ne sont pas encore dans
 * le résumé, s'ils sont assez nombreux. N'échoue jamais : un résumé manqué
 * sera rattrapé à la question suivante, la réponse de l'athlète n'en dépend pas.
 */
export async function mettreAJourResume(
  userId: string,
  resume: ResumeConversation | null,
  debutFenetre: Date | null
): Promise<void> {
  if (!debutFenetre) return;
  try {
    const hors = { userId, createdAt: { gt: resume?.jusquA ?? new Date(0), lt: debutFenetre } };
    if ((await prisma.chatMessage.count({ where: hors })) < SEUIL_RESUME) return;

    const nouveaux = (
      await prisma.chatMessage.findMany({ where: hors, orderBy: { createdAt: "desc" }, take: MAX_MESSAGES_RESUMES })
    ).reverse();
    const echanges = nouveaux
      .map((m) => {
        const texte = m.content.length > MAX_CARACTERES_MESSAGE ? `${m.content.slice(0, MAX_CARACTERES_MESSAGE)}…` : m.content;
        return `${m.role === "user" ? "Athlète" : "Coach"} : ${texte}`;
      })
      .join("\n");

    const response = await askClaude({
      modele: MODELE_CHAT,
      etiquette: "chat_resume",
      system: CONSIGNES_RESUME,
      messages: [
        {
          role: "user",
          content: `Résumé actuel : ${resume?.texte ?? "(aucun)"}\n\nNouveaux échanges :\n${echanges}`,
        },
      ],
      maxTokens: MAX_TOKENS.resumeChat,
    });
    const texte = response.text.trim();
    await recordAiCall({ userId, kind: "chat_resume", response, succeeded: Boolean(texte) });
    if (!texte) return;

    const jusquA = nouveaux[nouveaux.length - 1].createdAt;
    await prisma.resumeChat.upsert({
      where: { userId },
      create: { userId, texte, jusquA },
      update: { texte, jusquA },
    });
  } catch (err) {
    console.error("Mise à jour du résumé de conversation impossible :", err);
  }
}
