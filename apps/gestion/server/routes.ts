import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "./prisma.js";
import { exigerAdmin, type GestionRequest } from "./auth.js";
import { chargeDepuisBase, chargerParametres, construireTableau } from "./tableau.js";
import { parametresSchema } from "./parametres.js";
import { aujourdhuiParis, moisDe, nomMois } from "./calculs.js";

type Handler = (req: GestionRequest, res: Response) => Promise<void>;
const ah = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.");
const versDate = (d: string) => new Date(`${d}T00:00:00Z`);

export const CATEGORIES = [
  "hebergement",
  "base_de_donnees",
  "ia",
  "email",
  "domaine",
  "logiciel",
  "materiel",
  "juridique",
  "marketing",
  "banque",
  "autre",
] as const;

const chargeSchema = z
  .object({
    libelle: z.string().trim().min(1).max(120),
    categorie: z.enum(CATEGORIES),
    montantCents: z.number().int().min(0).max(100_000_000),
    frequence: z.enum(["ponctuelle", "mensuelle", "annuelle"]),
    debut: dateSchema,
    fin: dateSchema.nullable().default(null),
    notes: z.string().trim().max(500).nullable().default(null),
  })
  .refine((c) => !c.fin || c.fin >= c.debut, { message: "La fin précède le début.", path: ["fin"] });

const encaissementSchema = z.object({
  date: dateSchema,
  libelle: z.string().trim().min(1).max(120),
  categorie: z.enum(["abonnement", "autre"]).default("abonnement"),
  montantCents: z.number().int().min(-100_000_000).max(100_000_000),
  fraisCents: z.number().int().min(0).max(100_000_000).default(0),
});

function invalide(res: Response, err: z.ZodError) {
  res.status(400).json({ error: err.issues[0]?.message ?? "Données invalides." });
}

export const api = Router();
api.use(exigerAdmin);

api.get(
  "/session",
  ah(async (req, res) => {
    const u = await prisma.user.findUnique({ where: { id: req.adminId }, select: { email: true, name: true } });
    res.json(u);
  })
);

api.get(
  "/tableau",
  ah(async (req, res) => {
    const courante = Number(aujourdhuiParis().slice(0, 4));
    const annee = Number(req.query.annee ?? courante);
    if (!Number.isInteger(annee) || annee < 2020 || annee > courante + 1) {
      res.status(400).json({ error: "Année invalide." });
      return;
    }
    res.json(await construireTableau(prisma, annee));
  })
);

// ─── Charges ──────────────────────────────────────────────────────────────

api.get(
  "/charges",
  ah(async (_req, res) => {
    const charges = await prisma.gestionCharge.findMany({ orderBy: [{ debut: "desc" }, { createdAt: "desc" }] });
    res.json(charges.map((c) => ({ ...chargeDepuisBase(c), notes: c.notes })));
  })
);

api.post(
  "/charges",
  ah(async (req, res) => {
    const parsed = chargeSchema.safeParse(req.body);
    if (!parsed.success) return invalide(res, parsed.error);
    const c = parsed.data;
    const cree = await prisma.gestionCharge.create({
      data: { ...c, debut: versDate(c.debut), fin: c.fin ? versDate(c.fin) : null },
    });
    res.status(201).json({ ...chargeDepuisBase(cree), notes: cree.notes });
  })
);

api.put(
  "/charges/:id",
  ah(async (req, res) => {
    const parsed = chargeSchema.safeParse(req.body);
    if (!parsed.success) return invalide(res, parsed.error);
    const c = parsed.data;
    const existe = await prisma.gestionCharge.count({ where: { id: req.params.id } });
    if (!existe) {
      res.status(404).json({ error: "Charge introuvable." });
      return;
    }
    const maj = await prisma.gestionCharge.update({
      where: { id: req.params.id },
      data: { ...c, debut: versDate(c.debut), fin: c.fin ? versDate(c.fin) : null },
    });
    res.json({ ...chargeDepuisBase(maj), notes: maj.notes });
  })
);

api.delete(
  "/charges/:id",
  ah(async (req, res) => {
    const { count } = await prisma.gestionCharge.deleteMany({ where: { id: req.params.id } });
    res.status(count ? 204 : 404).end();
  })
);

// ─── Encaissements ────────────────────────────────────────────────────────

function encaissementSortie(e: {
  id: string;
  date: Date;
  libelle: string;
  categorie: string;
  montantCents: number;
  fraisCents: number;
}) {
  return { ...e, date: e.date.toISOString().slice(0, 10) };
}

api.get(
  "/encaissements",
  ah(async (_req, res) => {
    const lignes = await prisma.gestionEncaissement.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
    res.json(lignes.map(encaissementSortie));
  })
);

api.post(
  "/encaissements",
  ah(async (req, res) => {
    const parsed = encaissementSchema.safeParse(req.body);
    if (!parsed.success) return invalide(res, parsed.error);
    const cree = await prisma.gestionEncaissement.create({ data: { ...parsed.data, date: versDate(parsed.data.date) } });
    res.status(201).json(encaissementSortie(cree));
  })
);

api.put(
  "/encaissements/:id",
  ah(async (req, res) => {
    const parsed = encaissementSchema.safeParse(req.body);
    if (!parsed.success) return invalide(res, parsed.error);
    const existe = await prisma.gestionEncaissement.count({ where: { id: req.params.id } });
    if (!existe) {
      res.status(404).json({ error: "Encaissement introuvable." });
      return;
    }
    const maj = await prisma.gestionEncaissement.update({
      where: { id: req.params.id },
      data: { ...parsed.data, date: versDate(parsed.data.date) },
    });
    res.json(encaissementSortie(maj));
  })
);

api.delete(
  "/encaissements/:id",
  ah(async (req, res) => {
    const { count } = await prisma.gestionEncaissement.deleteMany({ where: { id: req.params.id } });
    res.status(count ? 204 : 404).end();
  })
);

/**
 * Pré-remplit l'encaissement du mois à partir des comptes sur une offre
 * payante. Une estimation, à corriger : aucun paiement n'est branché, rien ne
 * garantit que ces comptes ont effectivement payé.
 */
api.post(
  "/encaissements/estimation",
  ah(async (_req, res) => {
    const aujourdhui = aujourdhuiParis();
    const libelle = `Abonnements ${nomMois(moisDe(aujourdhui))} (estimation)`;
    if (await prisma.gestionEncaissement.count({ where: { libelle } })) {
      res.status(409).json({ error: "L'estimation de ce mois existe déjà : modifie-la plutôt." });
      return;
    }
    const p = await chargerParametres(prisma);
    const clients = { role: { not: "admin" } };
    const [standard, premium] = await Promise.all([
      prisma.user.count({ where: { ...clients, plan: "standard" } }),
      prisma.user.count({ where: { ...clients, plan: "premium" } }),
    ]);
    const montant = standard * p.prixStandardCents + premium * p.prixPremiumCents;
    if (montant === 0) {
      res.status(409).json({ error: "Aucun compte sur une offre payante : rien à estimer." });
      return;
    }
    const cree = await prisma.gestionEncaissement.create({
      data: { date: versDate(aujourdhui), libelle, categorie: "abonnement", montantCents: montant, fraisCents: 0 },
    });
    res.status(201).json(encaissementSortie(cree));
  })
);

// ─── Paramètres ───────────────────────────────────────────────────────────

api.get(
  "/parametres",
  ah(async (_req, res) => {
    res.json(await chargerParametres(prisma));
  })
);

api.put(
  "/parametres",
  ah(async (req, res) => {
    const parsed = parametresSchema.safeParse(req.body);
    if (!parsed.success) return invalide(res, parsed.error);
    await prisma.gestionParametres.upsert({
      where: { id: "unique" },
      create: { id: "unique", valeurs: parsed.data },
      update: { valeurs: parsed.data },
    });
    res.json(parsed.data);
  })
);
