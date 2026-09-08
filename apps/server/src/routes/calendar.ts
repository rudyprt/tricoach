import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { ah } from "../lib/http.js";
import { serializeSession } from "../lib/session.js";

export const calendarRouter = Router();
calendarRouter.use(requireAuth);

/** Échappement iCalendar (RFC 5545) : virgules, points-virgules et retours à la ligne. */
function escapeIcs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Découpe à 75 octets, comme l'exige la RFC, sinon certains clients tronquent. */
function foldLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const chunks: string[] = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char, "utf8") > 74) {
      chunks.push(current);
      current = " " + char;
    } else {
      current += char;
    }
  }
  chunks.push(current);
  return chunks.join("\r\n");
}

function icsDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

const SPORT_LABELS: Record<string, string> = {
  natation: "Natation",
  velo: "Vélo",
  course: "Course à pied",
  renfo: "Renforcement",
  repos: "Repos",
};

calendarRouter.get(
  "/sessions.ics",
  ah(async (req: AuthedRequest, res) => {
    const sessions = await prisma.session.findMany({
      where: { userId: req.userId!, sport: { not: "repos" } },
      orderBy: { date: "asc" },
    });

    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//TriCoach//Programme d'entrainement//FR",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:TriCoach — mes séances",
    ];

    for (const raw of sessions) {
      const session = serializeSession(raw);
      const sport = SPORT_LABELS[session.sport] ?? session.sport;
      const next = new Date(session.date);
      next.setUTCDate(next.getUTCDate() + 1);

      const description: string[] = [];
      if (session.objectif) description.push(`Objectif : ${session.objectif}`);
      if (session.description) description.push(session.description);
      if (session.structure) {
        description.push(
          `Échauffement (${session.structure.echauffement.dureeMin} min) : ${session.structure.echauffement.cible} — ${session.structure.echauffement.description}`,
          `Corps (${session.structure.corps.dureeMin} min) : ${session.structure.corps.cible} — ${session.structure.corps.description}`
        );
        for (const ex of session.structure.corps.exercices ?? []) {
          description.push(`  • ${ex.repetitions} à ${ex.allure}${ex.recuperation ? ` (récup ${ex.recuperation})` : ""}`);
        }
        description.push(
          `Retour au calme (${session.structure.retourCalme.dureeMin} min) : ${session.structure.retourCalme.cible} — ${session.structure.retourCalme.description}`
        );
      }

      // Événements sur la journée entière : l'heure d'entraînement n'est pas
      // connue, et un créneau arbitraire encombrerait l'agenda de l'athlète.
      lines.push(
        "BEGIN:VEVENT",
        `UID:${session.id}@tricoach`,
        `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
        `DTSTART;VALUE=DATE:${icsDate(session.date)}`,
        `DTEND;VALUE=DATE:${icsDate(next)}`,
        foldLine(`SUMMARY:${escapeIcs(`${sport} — ${session.titre} (${session.dureeMin} min)`)}`),
        foldLine(`DESCRIPTION:${escapeIcs(description.join("\n"))}`),
        `STATUS:${session.status === "faite" ? "CONFIRMED" : "TENTATIVE"}`,
        "END:VEVENT"
      );
    }

    lines.push("END:VCALENDAR");

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="tricoach-seances.ics"');
    res.send(lines.join("\r\n") + "\r\n");
  })
);
