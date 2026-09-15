import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { ah, HttpError } from "../lib/http.js";
import {
  FORMATS,
  LIBELLES_FORMAT,
  LIBELLES_PRIORITE,
  PRIORITES,
  synchroniserObjectif,
  type FormatCourse,
  type PrioriteCourse,
} from "../lib/races.js";

export const racesRouter = Router();
racesRouter.use(requireAuth);

const courseSchema = z.object({
  nom: z.string().trim().min(1, "Donnez un nom à votre course.").max(120, "Nom trop long."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ."),
  format: z.enum(FORMATS).default("autre"),
  priorite: z.enum(PRIORITES).default("A"),
  lieu: z.string().trim().max(120, "Lieu trop long.").default(""),
  objectifTemps: z.string().trim().max(40, "Temps visé trop long.").default(""),
});

function serialize(course: {
  id: string;
  nom: string;
  date: Date;
  format: string;
  priorite: string;
  lieu: string;
  objectifTemps: string;
}) {
  return {
    ...course,
    date: course.date.toISOString().slice(0, 10),
    formatLabel: LIBELLES_FORMAT[course.format as FormatCourse] ?? course.format,
    prioriteLabel: LIBELLES_PRIORITE[course.priorite as PrioriteCourse] ?? course.priorite,
  };
}

/** Une limite évite qu'un athlète inscrive une saison entière de cinquante dossards. */
const MAX_COURSES = 30;

racesRouter.get(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const courses = await prisma.race.findMany({
      where: { userId: req.userId! },
      orderBy: { date: "asc" },
      take: MAX_COURSES + 10,
    });
    res.json({ courses: courses.map(serialize) });
  })
);

racesRouter.post(
  "/",
  ah(async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const parsed = courseSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Course invalide.");

    if ((await prisma.race.count({ where: { userId } })) >= MAX_COURSES) {
      throw new HttpError(400, `Votre calendrier est limité à ${MAX_COURSES} courses.`);
    }

    const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new HttpError(400, "Date invalide.");

    const course = await prisma.race.create({ data: { ...parsed.data, date, userId } });
    await synchroniserObjectif(userId);

    res.status(201).json(serialize(course));
  })
);

racesRouter.patch(
  "/:id",
  ah(async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const parsed = courseSchema.partial().safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Course invalide.");

    // updateMany plutôt que update : la clause sur userId empêche de modifier
    // la course d'un autre athlète, ce qu'un update par identifiant seul
    // n'interdirait pas.
    const { date, ...reste } = parsed.data;
    const maj = await prisma.race.updateMany({
      where: { id: req.params.id, userId },
      data: { ...reste, ...(date ? { date: new Date(`${date}T00:00:00.000Z`) } : {}) },
    });
    if (maj.count === 0) throw new HttpError(404, "Course introuvable.");

    await synchroniserObjectif(userId);
    const course = await prisma.race.findUniqueOrThrow({ where: { id: req.params.id } });
    res.json(serialize(course));
  })
);

racesRouter.delete(
  "/:id",
  ah(async (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const suppression = await prisma.race.deleteMany({ where: { id: req.params.id, userId } });
    if (suppression.count === 0) throw new HttpError(404, "Course introuvable.");

    await synchroniserObjectif(userId);
    res.json({ ok: true });
  })
);
