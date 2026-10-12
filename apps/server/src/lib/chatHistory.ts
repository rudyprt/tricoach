/**
 * Ce que le chat du coach envoie réellement à l'API.
 *
 * Un fil de discussion n'a pas de fin : sans fenêtre, chaque nouveau message
 * renvoie toute la conversation depuis le premier jour. Le coût d'un échange
 * croît alors avec l'ancienneté du compte, et c'est l'athlète le plus fidèle
 * qui coûte le plus cher.
 *
 * L'historique complet reste en base et reste affiché : seul l'envoi est
 * tronqué. Six messages couvrent trois échanges, de quoi suivre le fil en
 * cours ; ce qui s'est dit avant arrive par un résumé tenu à jour (voir
 * resumeChat.ts), et le contexte durable (profil, zones, charge, séances) par
 * le prompt système.
 */

export interface MessageModele {
  role: "user" | "assistant";
  content: string;
}

/** Messages du fil envoyés au modèle, en plus de la question qu'on vient de poser. */
export const FENETRE_CHAT = 6;

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
export function fenetreHistorique(messages: MessageModele[], taille = FENETRE_CHAT + 1): MessageModele[] {
  const fenetre = messages.slice(-taille);
  const premierTourAthlete = fenetre.findIndex((m) => m.role === "user");
  // Pas un seul tour de l'athlète dans la fenêtre : il n'y a rien d'envoyable.
  // Le cas ne se produit pas depuis la route, qui ajoute toujours la question.
  return premierTourAthlete === -1 ? [] : fenetre.slice(premierTourAthlete);
}
