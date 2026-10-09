-- Outil de gestion (apps/gestion) : charges, encaissements, paramètres,
-- photographies mensuelles des utilisateurs, et coût IA agrégé par mois.

CREATE TABLE "CoutIaMensuel" (
    "mois" TEXT NOT NULL,
    "coutMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "appels" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoutIaMensuel_pkey" PRIMARY KEY ("mois")
);

-- Reprise de l'existant : les appels encore en base. Ceux des comptes déjà
-- supprimés sont perdus, l'agrégat ne fait foi qu'à partir d'aujourd'hui.
INSERT INTO "CoutIaMensuel" ("mois", "coutMicroUsd", "appels", "updatedAt")
SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris', 'YYYY-MM'),
       SUM("costMicroUsd"),
       COUNT(*),
       CURRENT_TIMESTAMP
FROM "AiCall"
GROUP BY 1;

CREATE TABLE "GestionCharge" (
    "id" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "categorie" TEXT NOT NULL,
    "montantCents" INTEGER NOT NULL,
    "frequence" TEXT NOT NULL,
    "debut" DATE NOT NULL,
    "fin" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GestionCharge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GestionCharge_debut_idx" ON "GestionCharge"("debut");

CREATE TABLE "GestionEncaissement" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "libelle" TEXT NOT NULL,
    "categorie" TEXT NOT NULL DEFAULT 'abonnement',
    "montantCents" INTEGER NOT NULL,
    "fraisCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GestionEncaissement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GestionEncaissement_date_idx" ON "GestionEncaissement"("date");

CREATE TABLE "GestionParametres" (
    "id" TEXT NOT NULL DEFAULT 'unique',
    "valeurs" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GestionParametres_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GestionInstantane" (
    "mois" TEXT NOT NULL,
    "inscrits" INTEGER NOT NULL,
    "standard" INTEGER NOT NULL,
    "premium" INTEGER NOT NULL,
    "essais" INTEGER NOT NULL,
    "actifs30j" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GestionInstantane_pkey" PRIMARY KEY ("mois")
);
