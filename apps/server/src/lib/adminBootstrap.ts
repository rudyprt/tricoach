import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { ADMIN_ROLE } from "../middleware/admin.js";

/**
 * Amorçage du rôle administrateur par variable d'environnement.
 *
 * Le script en ligne de commande reste la voie recommandée, mais il suppose un
 * accès à un terminal. Cette variable permet de désigner le premier
 * administrateur depuis le tableau de bord de l'hébergeur — donc depuis un
 * navigateur, y compris sur téléphone.
 *
 * Deux garde-fous : seul un compte DÉJÀ INSCRIT est promu (la variable ne crée
 * jamais de compte, et ne permet donc pas de s'attribuer une adresse qu'on ne
 * possède pas en la devançant), et la promotion est journalisée.
 */
export function bootstrapAdminEmails(): string[] {
  return env()
    .ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isBootstrapAdmin(email: string): boolean {
  return bootstrapAdminEmails().includes(email.trim().toLowerCase());
}

/**
 * Aligne le rôle en base sur la variable d'environnement. Renvoie le rôle
 * effectif, pour que l'appelant puisse répondre avec la valeur à jour.
 *
 * Ne rétrograde jamais : retirer une adresse de la variable ne retire pas le
 * rôle (sinon un oubli de configuration priverait l'application de tout
 * administrateur). La rétrogradation passe par l'interface ou le script.
 */
export async function syncBootstrapAdmin(user: {
  id: string;
  email: string;
  role: string;
}): Promise<string> {
  if (user.role === ADMIN_ROLE || !isBootstrapAdmin(user.email)) {
    return user.role;
  }

  await prisma.user.update({ where: { id: user.id }, data: { role: ADMIN_ROLE } });
  await prisma.adminAction
    .create({
      data: {
        adminId: user.id,
        targetUserId: user.id,
        action: "role.bootstrap",
        details: { de: user.role, vers: ADMIN_ROLE, source: "ADMIN_EMAILS" },
      },
    })
    .catch((err) => console.error("Journalisation de l'amorçage admin impossible :", err));

  console.info(`Rôle administrateur accordé à ${user.email} via ADMIN_EMAILS.`);
  return ADMIN_ROLE;
}
