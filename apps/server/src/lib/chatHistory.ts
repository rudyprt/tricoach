/**
 * Ce que le chat du coach envoie réellement à l'API.
 *
 * Un fil de discussion n'a pas de fin : sans fenêtre, chaque nouveau message
 * renvoie toute la conversation depuis le premier jour. Le coût d'un échange
 * croît alors avec l'ancienneté du compte, et c'est l'athlète le plus fidèle
 * qui coûte le plus cher.
 *
 * L'historique complet reste en base et reste affiché : seul l'envoi est
 * tronqué. Douze messages couvrent six échanges, de quoi suivre un fil de
 * discussion sans porter indéfiniment ce qui a été dit le mois dernier — le
 * contexte durable (profil, zones, charge, séances) arrive par le prompt
 * système, pas par l'historique.
 */

export interface MessageModele {
  role: "user" | "assistant";
  content: string;
}

/** Nombre de messages envoyés au modèle, le nouveau message compris. */
export const FENETRE_CHAT = 12;

/**
 * Garde les derniers messages, en commençant par un message de l'athlète.
 *
 * Tronquer en aveugle peut faire débuter la fenêtre sur une réponse du coach ;
 * l'API refuse alors la requête, car une conversation commence par un tour de
 * l'utilisateur. Le cas n'est pas théorique : la fenêtre tombe au milieu d'une
 * paire dès que le nombre de messages précédents est impair.
 *
 * Le dernier message étant toujours la question qu'on vient de poser, le
 * résultat n'est jamais vide.
 */
export function fenetreHistorique(messages: MessageModele[], taille = FENETRE_CHAT): MessageModele[] {
  const fenetre = messages.slice(-taille);
  const premierTourAthlete = fenetre.findIndex((m) => m.role === "user");
  // Pas un seul tour de l'athlète dans la fenêtre : il n'y a rien d'envoyable.
  // Le cas ne se produit pas depuis la route, qui ajoute toujours la question.
  return premierTourAthlete === -1 ? [] : fenetre.slice(premierTourAthlete);
}
