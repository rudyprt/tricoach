-- Temps visé sur l'objectif, ou volonté de simplement le terminer.
ALTER TABLE "AthleteProfile" ADD COLUMN "objectifTemps" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AthleteProfile" ADD COLUMN "objectifFinir" BOOLEAN NOT NULL DEFAULT false;
