import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";

/**
 * Amorçage du premier administrateur : il ne peut pas exister de bouton
 * "me promouvoir" dans l'application, sinon le contrôle d'accès ne vaut rien.
 * La promotion passe donc par un accès à la base.
 *
 *   npm run admin -w apps/server -- promote vous@exemple.com
 *   npm run admin -w apps/server -- demote autre@exemple.com
 *   npm run admin -w apps/server -- list
 */
async function main() {
  env(); // valide la configuration avant toute écriture

  const [command, email] = process.argv.slice(2);

  if (command === "list") {
    const admins = await prisma.user.findMany({
      where: { role: "admin" },
      select: { email: true, name: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    if (admins.length === 0) {
      console.log("Aucun administrateur. Utilisez : npm run admin -w apps/server -- promote <email>");
      return;
    }
    console.log(`${admins.length} administrateur(s) :`);
    for (const a of admins) console.log(`  - ${a.email} (${a.name})`);
    return;
  }

  if (command !== "promote" && command !== "demote") {
    console.error("Usage : npm run admin -w apps/server -- <promote|demote|list> [email]");
    process.exitCode = 1;
    return;
  }

  if (!email) {
    console.error(`Usage : npm run admin -w apps/server -- ${command} <email>`);
    process.exitCode = 1;
    return;
  }

  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) {
    console.error(`Aucun compte pour ${normalized}. Créez-le d'abord depuis l'application.`);
    process.exitCode = 1;
    return;
  }

  if (command === "demote") {
    const remaining = await prisma.user.count({ where: { role: "admin", id: { not: user.id } } });
    if (remaining === 0) {
      console.error("Refusé : ce compte est le dernier administrateur.");
      process.exitCode = 1;
      return;
    }
  }

  const role = command === "promote" ? "admin" : "athlete";
  await prisma.user.update({ where: { id: user.id }, data: { role } });
  console.log(`${normalized} a désormais le rôle "${role}".`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
