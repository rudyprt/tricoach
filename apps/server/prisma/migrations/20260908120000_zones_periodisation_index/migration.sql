-- Fuseau horaire de l'athlète (base du calcul de la semaine d'entraînement)
ALTER TABLE "User" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris';

-- FTP optionnelle pour des zones de puissance vélo exactes
ALTER TABLE "AthleteProfile" ADD COLUMN "ftpWatts" INTEGER;

-- Phase de périodisation appliquée à la semaine générée
ALTER TABLE "TrainingPlan" ADD COLUMN "phase" TEXT;

-- La structure de séance passe de TEXT (JSON stringifié) à JSONB
ALTER TABLE "Session" ADD COLUMN "structure_jsonb" JSONB;
UPDATE "Session"
SET "structure_jsonb" = "structure"::jsonb
WHERE "structure" IS NOT NULL AND left(btrim("structure"), 1) = '{';
ALTER TABLE "Session" DROP COLUMN "structure";
ALTER TABLE "Session" RENAME COLUMN "structure_jsonb" TO "structure";

-- Jetons de réinitialisation de mot de passe (seul le hash est conservé)
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Index sur les accès les plus fréquents (listes par utilisateur)
CREATE INDEX "TrainingPlan_userId_weekStart_idx" ON "TrainingPlan"("userId", "weekStart");
CREATE INDEX "Session_userId_date_idx" ON "Session"("userId", "date");
CREATE INDEX "Session_planId_idx" ON "Session"("planId");
CREATE INDEX "ChatMessage_userId_createdAt_idx" ON "ChatMessage"("userId", "createdAt");
