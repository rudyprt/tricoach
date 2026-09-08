import { prisma } from "./prisma.js";
import { costMicroUsd } from "./pricing.js";
import type { ClaudeResponse } from "./anthropic.js";

export type AiCallKind = "plan_generation" | "plan_progression" | "chat";

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

  try {
    await prisma.aiCall.create({
      data: {
        userId: params.userId,
        kind: params.kind,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        costMicroUsd: costMicroUsd(model, usage),
        succeeded: params.succeeded,
      },
    });
  } catch (err) {
    console.error("Journalisation de l'appel IA impossible :", err);
  }
}
