import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.js";
import { costMicroUsd, type TokenUsage } from "./pricing.js";
import { reflexionPermanente } from "./modeles.js";

export function isAiConfigured(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = env().ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AiNotConfiguredError();
  }
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      "Clé API Anthropic manquante. Ajoutez ANTHROPIC_API_KEY dans apps/server/.env pour activer le coach IA."
    );
    this.name = "AiNotConfiguredError";
  }
}

export interface ClaudeResponse {
  text: string;
  model: string;
  usage: TokenUsage;
  /** Outils que le modèle demande d'exécuter. Vide quand il répond directement. */
  toolUses: { id: string; name: string; input: unknown }[];
  /** Le tour de l'assistant tel quel, à renvoyer avec les résultats d'outils. */
  content: Anthropic.ContentBlock[];
  stopReason: string | null;
}

/**
 * Un tour de conversation. Le contenu peut être un simple texte, ou les blocs
 * bruts du format — nécessaires pour renvoyer un résultat d'outil, qui n'est
 * pas du texte.
 */
export type ClaudeMessage = {
  role: "user" | "assistant";
  content: Anthropic.MessageParam["content"];
};

/**
 * Un appel au modèle.
 *
 * Le prompt système arrive en deux parties. `system` porte les consignes, les
 * mêmes pour tous les athlètes : il est mis en cache, et les appels suivants ne
 * le paient plus qu'au dixième de son prix (les outils, placés avant lui, en
 * profitent aussi). `contexte` porte ce qui change d'un athlète ou d'une
 * question à l'autre : placé après, il ne casse pas le cache.
 */
export async function askClaude(params: {
  modele: string;
  /** Type d'appel, pour le journal. */
  etiquette: string;
  system: string;
  contexte?: string;
  messages: ClaudeMessage[];
  maxTokens: number;
  tools?: Anthropic.Tool[];
}): Promise<ClaudeResponse> {
  const anthropic = getClient();
  const system = [
    { type: "text", text: params.system, cache_control: { type: "ephemeral" } },
    ...(params.contexte ? [{ type: "text", text: params.contexte }] : []),
  ];
  // Cette version du SDK ne type ni "thinking" ni le cache, que l'API accepte.
  // La réflexion est désactivée là où c'est permis, pour que tout le budget de
  // tokens serve la réponse visible ; les modèles qui pensent toujours la gardent,
  // et leur plafond de sortie en tient compte.
  const response = (await anthropic.messages.create({
    model: params.modele,
    max_tokens: params.maxTokens,
    system,
    messages: params.messages,
    ...(params.tools?.length ? { tools: params.tools } : {}),
    ...(reflexionPermanente(params.modele) ? {} : { thinking: { type: "disabled" } }),
  } as any)) as Anthropic.Message;
  const textBlock = response.content.find((block) => block.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const toolUses = response.content
    .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
    .map((block) => ({ id: block.id, name: block.name, input: block.input }));
  // Un tour qui ne contient qu'un appel d'outil n'a pas de texte, et c'est
  // normal : ce n'est pas la réponse finale.
  if (!text && toolUses.length === 0) {
    console.error(
      "Réponse Claude sans contenu texte. stop_reason:",
      response.stop_reason,
      "content:",
      JSON.stringify(response.content)
    );
  } else if (response.stop_reason === "max_tokens") {
    console.error(
      `Réponse Claude tronquée par la limite de tokens (maxTokens=${params.maxTokens}, longueur reçue=${text.length} caractères).`
    );
  }

  // Cette version du SDK ne type pas encore les compteurs de cache, que l'API
  // renvoie pourtant : on les lit sans supposer leur présence.
  const brut = (response.usage ?? {}) as {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  const usage: TokenUsage = {
    inputTokens: brut.input_tokens ?? 0,
    outputTokens: brut.output_tokens ?? 0,
    cacheReadTokens: brut.cache_read_input_tokens ?? 0,
    cacheWriteTokens: brut.cache_creation_input_tokens ?? 0,
  };
  const model = response.model ?? params.modele;
  console.info(journalAppel(params.etiquette, model, usage));

  return { text, toolUses, content: response.content, stopReason: response.stop_reason ?? null, model, usage };
}

/**
 * Une ligne par appel : ce qui est entré, sorti, lu ou écrit dans le cache, et
 * le prix. C'est elle qui dit si une économie annoncée se vérifie.
 */
export function journalAppel(etiquette: string, model: string, usage: TokenUsage): string {
  const cout = costMicroUsd(model, usage) / 1_000_000;
  return (
    `[ia] ${etiquette} modele=${model} entree=${usage.inputTokens} sortie=${usage.outputTokens}` +
    ` cache_lu=${usage.cacheReadTokens} cache_ecrit=${usage.cacheWriteTokens} cout=${cout.toFixed(5)}$`
  );
}
