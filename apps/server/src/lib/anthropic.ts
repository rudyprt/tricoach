import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.js";
import type { TokenUsage } from "./pricing.js";

export const MODEL = "claude-sonnet-5";

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

export async function askClaude(params: {
  system: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
  tools?: Anthropic.Tool[];
}): Promise<ClaudeResponse> {
  const anthropic = getClient();
  // Cette version du SDK ne type pas encore "thinking", mais l'API l'accepte : on le
  // désactive explicitement pour que tout le budget de tokens serve la réponse visible
  // (sans ça, le modèle peut consommer max_tokens entier en réflexion interne invisible).
  const response = (await anthropic.messages.create({
    model: MODEL,
    max_tokens: params.maxTokens ?? 2000,
    system: params.system,
    messages: params.messages,
    ...(params.tools?.length ? { tools: params.tools } : {}),
    thinking: { type: "disabled" },
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
      `Réponse Claude tronquée par la limite de tokens (maxTokens=${params.maxTokens ?? 2000}, longueur reçue=${text.length} caractères).`
    );
  }

  // Cette version du SDK ne type pas encore les compteurs de cache, que l'API
  // renvoie pourtant : on les lit sans supposer leur présence.
  const usage = (response.usage ?? {}) as {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };

  return {
    text,
    toolUses,
    content: response.content,
    stopReason: response.stop_reason ?? null,
    model: response.model ?? MODEL,
    usage: {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    },
  };
}
