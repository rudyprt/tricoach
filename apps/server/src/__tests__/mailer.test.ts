import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail })) },
  createTransport: vi.fn(() => ({ sendMail })),
}));

/**
 * L'envoi d'e-mails est la seule voie de récupération d'un compte : son
 * comportement en présence comme en l'absence de configuration doit être connu.
 */
describe("envoi d'e-mails", () => {
  const baseEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    sendMail.mockReset();
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.JWT_SECRET = "x".repeat(32);
    process.env.APP_URL = "https://tricoach.example";
  });

  afterEach(() => {
    process.env = { ...baseEnv };
  });

  it("n'envoie rien et le signale quand SMTP n'est pas configuré", async () => {
    process.env.SMTP_HOST = "";
    process.env.NODE_ENV = "production";
    const { sendMail: send, isMailConfigured } = await import("../lib/mailer.js");
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(isMailConfigured()).toBe(false);
    await send({ to: "a@b.c", subject: "Test", text: "corps" });

    expect(sendMail).not.toHaveBeenCalled();
    // Le silence serait le pire des cas : l'absence d'envoi doit être bruyante.
    expect(erreur).toHaveBeenCalledWith(expect.stringContaining("n'a PAS été envoyé"));
    erreur.mockRestore();
  });

  it("envoie réellement quand SMTP est configuré", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "identifiant";
    process.env.SMTP_PASSWORD = "secret";
    process.env.MAIL_FROM = "TriCoach <no-reply@tricoach.example>";
    const { sendMail: send, isMailConfigured } = await import("../lib/mailer.js");

    expect(isMailConfigured()).toBe(true);
    await send({ to: "athlete@example.com", subject: "Bonjour", text: "corps" });

    expect(sendMail).toHaveBeenCalledWith({
      from: "TriCoach <no-reply@tricoach.example>",
      to: "athlete@example.com",
      subject: "Bonjour",
      text: "corps",
    });
  });

  it("construit des liens absolus vers l'application", async () => {
    process.env.APP_URL = "https://tricoach.example/";
    const { emailVerificationMail, passwordResetMail } = await import("../lib/mailer.js");

    const verif = emailVerificationMail("a@b.c", "Rudy", "jeton123");
    expect(verif.text).toContain("https://tricoach.example/verifier-email?token=jeton123");
    // Pas de double slash malgré l'URL terminée par un slash.
    expect(verif.text).not.toContain("example//");

    const reset = passwordResetMail("a@b.c", "jeton456");
    expect(reset.text).toContain("https://tricoach.example/reinitialiser-mot-de-passe?token=jeton456");
  });

  it("ne divulgue pas le jeton dans le sujet", async () => {
    const { emailVerificationMail } = await import("../lib/mailer.js");
    const mail = emailVerificationMail("a@b.c", "Rudy", "jeton-secret");
    expect(mail.subject).not.toContain("jeton-secret");
  });
});
