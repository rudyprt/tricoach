import nodemailer, { type Transporter } from "nodemailer";
import { env, isProduction } from "./env.js";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  /**
   * En-têtes supplémentaires. Sert au désabonnement en un clic : les messageries
   * affichent alors leur propre bouton, et l'athlète n'a pas à chercher le lien
   * — c'est aussi ce qui évite qu'il signale le message comme indésirable.
   */
  headers?: Record<string, string>;
}

let transporter: Transporter | null = null;

export function isMailConfigured(): boolean {
  return Boolean(env().SMTP_HOST);
}

function getTransporter(): Transporter {
  if (!transporter) {
    const config = env();
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    });
  }
  return transporter;
}

/** Remet à zéro le transporteur mis en cache (usage : tests). */
export function resetMailer(): void {
  transporter = null;
}

/**
 * Envoie un message. Sans configuration SMTP, le contenu est tracé côté serveur
 * : le parcours reste testable en développement, et l'absence de configuration
 * est signalée bruyamment en production plutôt que silencieusement ignorée.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (!isMailConfigured()) {
    if (isProduction()) {
      console.error(
        `[mailer] SMTP non configuré : le message "${mail.subject}" destiné à ${mail.to} n'a PAS été envoyé. ` +
          "Renseignez SMTP_HOST pour activer la récupération de compte."
      );
      return;
    }
    console.info(`[mailer] À: ${mail.to}\n[mailer] Sujet: ${mail.subject}\n${mail.text}`);
    return;
  }

  await getTransporter().sendMail({
    from: env().MAIL_FROM,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    headers: mail.headers,
  });
}

export function emailVerificationMail(to: string, name: string, token: string): Mail {
  const url = `${env().APP_URL.replace(/\/$/, "")}/verifier-email?token=${token}`;
  return {
    to,
    subject: "Confirmez votre adresse e-mail TriCoach",
    text: [
      `Bonjour ${name},`,
      "",
      "Confirmez votre adresse pour sécuriser votre compte TriCoach et pouvoir le récupérer en cas d'oubli de mot de passe :",
      url,
      "",
      "Ce lien est valable 24 heures.",
      "Si vous n'avez pas créé de compte TriCoach, ignorez cet e-mail.",
    ].join("\n"),
  };
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
