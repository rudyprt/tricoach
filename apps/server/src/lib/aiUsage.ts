import { prisma } from "./prisma.js";
import { costMicroUsd } from "./pricing.js";
import type { ClaudeResponse } from "./anthropic.js";

/** "2026-10" : le mois civil à Paris, là où l'activité est déclarée. */
export function moisParis(date: Date): string {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" })
    .format(date)
    .slice(0, 7);
}

export type AiCallKind = "plan_generation" | "plan_progression" | "chat" | "plan_course";

/**
 * Enregistre la consommation d'un appel au modèle. L'écriture ne doit jamais
 * faire échouer la requête de l'athlète : une panne de journalisation ne vaut
 * pas la perte d'un programme déjà généré.
 */
export async function recordAiCall(params: {
  userId: string;
  kind: AiCallKind;
  response?: ClaudeResponse;
  model?: string;
  succeeded: boolean;
}): Promise<void> {
  const usage = params.response?.usage ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  const model = params.response?.model ?? params.model ?? "inconnu";

  const cout = costMicroUsd(model, usage);
  const mois = moisParis(new Date());
  try {
    await prisma.$transaction([
      prisma.aiCall.create({
        data: {
          userId: params.userId,
          kind: params.kind,
          model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          costMicroUsd: cout,
          succeeded: params.succeeded,
        },
      }),
      // Agrégat mensuel : il survit à la suppression du compte, contrairement
      // à la ligne ci-dessus, et sert de référence à l'outil de gestion.
      prisma.coutIaMensuel.upsert({
        where: { mois },
        create: { mois, coutMicroUsd: cout, appels: 1 },
        update: { coutMicroUsd: { increment: cout }, appels: { increment: 1 } },
      }),
    ]);
  } catch (err) {
    console.error("Journalisation de l'appel IA impossible :", err);
  }
}
