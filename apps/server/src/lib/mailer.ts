import { env, isProduction } from "./env.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Aucun fournisseur d'e-mail n'est branché pour l'instant. Plutôt que de faire
 * croire à un envoi, on trace le message côté serveur : le flux de
 * réinitialisation est complet et testable en local, et il suffira de remplacer
 * cette fonction par un appel SMTP/API le jour où un fournisseur est choisi.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (isProduction()) {
    console.warn(
      `[mailer] Envoi d'e-mail non configuré : le message "${mail.subject}" destiné à ${mail.to} n'a pas été envoyé.`
    );
    return;
  }
  console.info(`[mailer] À: ${mail.to}\n[mailer] Sujet: ${mail.subject}\n${mail.text}`);
}

export function passwordResetMail(to: string, token: string): Mail {
  const url = `${env().APP_URL.replace(/\/$/, "")}/reinitialiser-mot-de-passe?token=${token}`;
  return {
    to,
    subject: "Réinitialisation de votre mot de passe TriCoach",
    text: [
      "Vous avez demandé à réinitialiser votre mot de passe TriCoach.",
      `Ouvrez ce lien pour choisir un nouveau mot de passe : ${url}`,
      "Ce lien est valable 1 heure et ne fonctionne qu'une seule fois.",
      "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",
    ].join("\n"),
  };
}
