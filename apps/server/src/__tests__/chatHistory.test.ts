import { describe, expect, it } from "vitest";
import { FENETRE_CHAT, fenetreHistorique, type MessageModele } from "../lib/chatHistory.js";

/**
 * La fenêtre d'envoi, éprouvée sans appeler le modèle.
 *
 * Deux fautes coûtent cher ici et ne se voient pas à la lecture : une fenêtre
 * qui laisse passer tout l'historique (la facture grimpe sans qu'on le sache)
 * et une fenêtre qui commence par une réponse du coach (l'API refuse, et le
 * chat ne répond plus au bout de quelques échanges).
 */

/** Un fil alternant question et réponse, comme la base le conserve. */
function fil(nombre: number): MessageModele[] {
  return Array.from({ length: nombre }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `message ${i}`,
  }));
}

describe("fenêtre d'historique du chat", () => {
  it("n'envoie jamais plus que la fenêtre", () => {
    expect(fenetreHistorique(fil(200)).length).toBeLessThanOrEqual(FENETRE_CHAT);
  });

  it("garde les messages les plus récents, pas les plus anciens", () => {
    const envoyes = fenetreHistorique(fil(100));
    expect(envoyes.at(-1)!.content).toBe("message 99");
    expect(envoyes.some((m) => m.content === "message 0")).toBe(false);
  });

  it("commence toujours par un tour de l'athlète", () => {
    // La coupe tombe au milieu d'une paire dès que le nombre de messages
    // précédents est impair : c'est précisément le cas que l'API refuse.
    for (let taille = 1; taille <= 60; taille++) {
      const envoyes = fenetreHistorique(fil(taille));
      expect(envoyes[0]?.role, `fil de ${taille} messages`).toBe("user");
    }
  });

  it("laisse passer un fil plus court que la fenêtre sans y toucher", () => {
    const court = fil(5);
    expect(fenetreHistorique(court)).toEqual(court);
  });

  it("respecte une fenêtre donnée explicitement", () => {
    expect(fenetreHistorique(fil(50), 4)).toHaveLength(4);
  });

  it("douze messages, soit six échanges", () => {
    // Si cette valeur change, le coût par message change avec elle.
    expect(FENETRE_CHAT).toBe(12);
  });
});
