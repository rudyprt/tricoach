import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { requireAdmin, ADMIN_ROLE } from "../middleware/admin.js";
import { ah, HttpError } from "../lib/http.js";
import { hasStandardAccess, isTrialActive, trialEndsAt, TRIAL_DAYS } from "../lib/subscription.js";
import { PRICING_UPDATED_AT } from "../lib/pricing.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

async function logAction(params: {
  adminId: string;
  targetUserId?: string | null;
  action: string;
  details?: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.adminAction.create({
    data: {
      adminId: params.adminId,
      targetUserId: params.targetUserId ?? null,
      action: params.action,
      details: params.details,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Vue d'ensemble                                                      */
/* ------------------------------------------------------------------ */

adminRouter.get(
  "/overview",
  ah(async (_req: AuthedRequest, res) => {
    const now = new Date();
    const trialCutoff = new Date(now.getTime() - TRIAL_DAYS * DAY_MS);

    const [
      totalUsers,
      byPlan,
      trialsActive,
      trialsExpiredOnFree,
      signups7,
      signups30,
      activeDay,
      activeWeek,
      activeMonth,
      neverSeen,
      aiTotals,
      aiByKind,
      aiLast30,
      plansGenerated30,
      profilesWithGoal,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.groupBy({ by: ["plan"], _count: { _all: true } }),
      // Comptes gratuits dont l'essai court encore.
      prisma.user.count({ where: { plan: "free", createdAt: { gt: trialCutoff } } }),
      // Essais terminés sans conversion : l'indicateur de perte le plus direct.
      prisma.user.count({ where: { plan: "free", createdAt: { lte: trialCutoff } } }),
      prisma.user.count({ where: { createdAt: { gte: daysAgo(7) } } }),
      prisma.user.count({ where: { createdAt: { gte: daysAgo(30) } } }),
      prisma.user.count({ where: { lastSeenAt: { gte: daysAgo(1) } } }),
      prisma.user.count({ where: { lastSeenAt: { gte: daysAgo(7) } } }),
      prisma.user.count({ where: { lastSeenAt: { gte: daysAgo(30) } } }),
      prisma.user.count({ where: { lastSeenAt: null } }),
      prisma.aiCall.aggregate({
        _sum: { costMicroUsd: true, inputTokens: true, outputTokens: true },
        _count: { _all: true },
      }),
      prisma.aiCall.groupBy({
        by: ["kind"],
        _sum: { costMicroUsd: true },
        _count: { _all: true },
      }),
      prisma.aiCall.aggregate({
        where: { createdAt: { gte: daysAgo(30) } },
        _sum: { costMicroUsd: true },
        _count: { _all: true },
      }),
      prisma.trainingPlan.count({ where: { generatedAt: { gte: daysAgo(30) } } }),
      prisma.athleteProfile.count({ where: { objectifDate: { gte: now } } }),
    ]);

    const planCounts = { free: 0, standard: 0, premium: 0 } as Record<string, number>;
    for (const row of byPlan) planCounts[row.plan] = row._count._all;

    const paying = (planCounts.standard ?? 0) + (planCounts.premium ?? 0);
    const cost30 = aiLast30._sum.costMicroUsd ?? 0;

    res.json({
      comptes: {
        total: totalUsers,
        parOffre: planCounts,
        payants: paying,
        tauxConversionPct: totalUsers > 0 ? Math.round((paying / totalUsers) * 1000) / 10 : 0,
        essaisEnCours: trialsActive,
        essaisExpiresNonConvertis: trialsExpiredOnFree,
        inscriptions7j: signups7,
        inscriptions30j: signups30,
      },
      frequentation: {
        actifs24h: activeDay,
        actifs7j: activeWeek,
        actifs30j: activeMonth,
        jamaisRevenus: neverSeen,
        // Part des comptes actifs sur le mois : la mesure de rétention la plus
        // lisible sans cohortes.
        retention30jPct: totalUsers > 0 ? Math.round((activeMonth / totalUsers) * 1000) / 10 : 0,
      },
      activite: {
        programmesGeneres30j: plansGenerated30,
        athletesAvecObjectifAVenir: profilesWithGoal,
      },
      coutIa: {
        totalMicroUsd: aiTotals._sum.costMicroUsd ?? 0,
        total30jMicroUsd: cost30,
        appelsTotal: aiTotals._count._all,
        appels30j: aiLast30._count._all,
        tokensEntree: aiTotals._sum.inputTokens ?? 0,
        tokensSortie: aiTotals._sum.outputTokens ?? 0,
        // Repère de rentabilité : ce que coûte un athlète payant sur 30 jours.
        coutMoyenParPayant30jMicroUsd: paying > 0 ? Math.round(cost30 / paying) : 0,
        parType: aiByKind.map((row) => ({
          kind: row.kind,
          appels: row._count._all,
          coutMicroUsd: row._sum.costMicroUsd ?? 0,
        })),
        tarifsMisAJourLe: PRICING_UPDATED_AT,
      },
    });
  })
);

/* ------------------------------------------------------------------ */
/* Fréquentation détaillée                                             */
/* ------------------------------------------------------------------ */

adminRouter.get(
  "/activity",
  ah(async (_req: AuthedRequest, res) => {
    const since = daysAgo(30);

    const [signups, actives, aiCalls] = await Promise.all([
      prisma.user.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      prisma.user.findMany({
        where: { lastSeenAt: { gte: since } },
        select: { lastSeenAt: true },
      }),
      prisma.aiCall.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true, costMicroUsd: true },
      }),
    ]);

    // Série journalière construite en mémoire : sur 30 jours le volume reste
    // trivial, et cela évite du SQL brut spécifique à Postgres.
    const days: { date: string; inscriptions: number; actifs: number; coutMicroUsd: number }[] = [];
    const index = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
      index.set(date, days.length);
      days.push({ date, inscriptions: 0, actifs: 0, coutMicroUsd: 0 });
    }

    const bump = (at: Date | null, field: "inscriptions" | "actifs", amount = 1) => {
      if (!at) return;
      const slot = index.get(at.toISOString().slice(0, 10));
      if (slot !== undefined) days[slot][field] += amount;
    };

    for (const u of signups) bump(u.createdAt, "inscriptions");
    for (const u of actives) bump(u.lastSeenAt, "actifs");
    for (const call of aiCalls) {
      const slot = index.get(call.createdAt.toISOString().slice(0, 10));
      if (slot !== undefined) days[slot].coutMicroUsd += call.costMicroUsd;
    }

    res.json({ jours: days });
  })
);

/* ------------------------------------------------------------------ */
/* Comptes                                                             */
/* ------------------------------------------------------------------ */

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  plan: z.enum(["free", "standard", "premium"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(["createdAt", "lastSeenAt"]).default("createdAt"),
});

adminRouter.get(
  "/users",
  ah(async (req: AuthedRequest, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Filtres invalides.");
    }
    const { q, plan, page, perPage, sort } = parsed.data;

    const where = {
      ...(plan ? { plan } : {}),
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" as const } },
              { name: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { [sort]: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          email: true,
          name: true,
          plan: true,
          role: true,
          timezone: true,
          createdAt: true,
          lastSeenAt: true,
          profile: { select: { objectif: true, objectifDate: true } },
          _count: { select: { sessions: true, trainingPlans: true, chatMessages: true } },
        },
      }),
    ]);

    // Coût IA par athlète sur la page courante uniquement : une agrégation
    // globale par utilisateur serait inutilement lourde.
    const costs = await prisma.aiCall.groupBy({
      by: ["userId"],
      where: { userId: { in: users.map((u) => u.id) } },
      _sum: { costMicroUsd: true },
    });
    const costByUser = new Map(costs.map((c) => [c.userId, c._sum.costMicroUsd ?? 0]));

    res.json({
      total,
      page,
      perPage,
      pages: Math.max(1, Math.ceil(total / perPage)),
      users: users.map((u) => ({
        ...u,
        trialEndsAt: trialEndsAt(u.createdAt),
        isTrialActive: isTrialActive(u.createdAt),
        hasStandardAccess: hasStandardAccess(u),
        coutIaMicroUsd: costByUser.get(u.id) ?? 0,
      })),
    });
  })
);

adminRouter.get(
  "/users/:id",
  ah(async (req: AuthedRequest, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        email: true,
        name: true,
        plan: true,
        role: true,
        timezone: true,
        createdAt: true,
        lastSeenAt: true,
        profile: true,
        _count: { select: { sessions: true, trainingPlans: true, chatMessages: true } },
      },
    });
    if (!user) throw new HttpError(404, "Compte introuvable.");

    const [aiUsage, recentPlans, sessionsByStatus] = await Promise.all([
      prisma.aiCall.groupBy({
        by: ["kind"],
        where: { userId: user.id },
        _sum: { costMicroUsd: true, inputTokens: true, outputTokens: true },
        _count: { _all: true },
      }),
      prisma.trainingPlan.findMany({
        where: { userId: user.id },
        orderBy: { generatedAt: "desc" },
        take: 5,
        select: { id: true, weekStart: true, generatedAt: true, phase: true },
      }),
      prisma.session.groupBy({
        by: ["status"],
        where: { userId: user.id },
        _count: { _all: true },
      }),
    ]);

    res.json({
      ...user,
      trialEndsAt: trialEndsAt(user.createdAt),
      isTrialActive: isTrialActive(user.createdAt),
      hasStandardAccess: hasStandardAccess(user),
      coutIa: aiUsage.map((row) => ({
        kind: row.kind,
        appels: row._count._all,
        coutMicroUsd: row._sum.costMicroUsd ?? 0,
        tokensEntree: row._sum.inputTokens ?? 0,
        tokensSortie: row._sum.outputTokens ?? 0,
      })),
      derniersProgrammes: recentPlans,
      seancesParStatut: sessionsByStatus.map((r) => ({ statut: r.status, nombre: r._count._all })),
    });
  })
);

/* ------------------------------------------------------------------ */
/* Gestion des abonnements                                             */
/* ------------------------------------------------------------------ */

const planSchema = z.object({
  plan: z.enum(["free", "standard", "premium"]),
  motif: z.string().trim().max(300).optional(),
});

/**
 * Le seul chemin qui accorde une offre payante. Il est réservé aux
 * administrateurs et systématiquement journalisé : c'est ce qui remplace le
 * paiement tant qu'aucun prestataire n'est branché.
 */
adminRouter.patch(
  "/users/:id/plan",
  ah(async (req: AuthedRequest, res) => {
    const parsed = planSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Offre invalide.");
    }

    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, plan: true, email: true },
    });
    if (!target) throw new HttpError(404, "Compte introuvable.");

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { plan: parsed.data.plan },
      select: { id: true, email: true, name: true, plan: true, role: true, createdAt: true },
    });

    await logAction({
      adminId: req.userId!,
      targetUserId: target.id,
      action: "plan.update",
      details: { de: target.plan, vers: parsed.data.plan, motif: parsed.data.motif ?? null },
    });

    res.json(updated);
  })
);

const roleSchema = z.object({
  role: z.enum(["athlete", "admin"]),
});

adminRouter.patch(
  "/users/:id/role",
  ah(async (req: AuthedRequest, res) => {
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Rôle invalide.");

    // Se retirer soi-même le rôle admin peut laisser l'application sans
    // administrateur : on l'interdit, la promotion d'un autre compte d'abord.
    if (req.params.id === req.userId && parsed.data.role !== ADMIN_ROLE) {
      throw new HttpError(400, "Vous ne pouvez pas retirer votre propre rôle d'administrateur.");
    }

    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, role: true },
    });
    if (!target) throw new HttpError(404, "Compte introuvable.");

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { role: parsed.data.role },
      select: { id: true, email: true, name: true, plan: true, role: true },
    });

    await logAction({
      adminId: req.userId!,
      targetUserId: target.id,
      action: "role.update",
      details: { de: target.role, vers: parsed.data.role },
    });

    res.json(updated);
  })
);

/* ------------------------------------------------------------------ */
/* Journal d'audit                                                     */
/* ------------------------------------------------------------------ */

adminRouter.get(
  "/audit",
  ah(async (req: AuthedRequest, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const actions = await prisma.adminAction.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        action: true,
        details: true,
        createdAt: true,
        admin: { select: { id: true, email: true, name: true } },
        targetUser: { select: { id: true, email: true, name: true } },
      },
    });
    res.json({ actions });
  })
);
