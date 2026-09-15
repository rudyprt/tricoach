-- Interruptions d'entrainement : blessure, maladie, indisponibilite. Elles
-- pilotent la reprise progressive du volume.
CREATE TABLE "TrainingPause" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "raison" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "debut" TIMESTAMP(3) NOT NULL,
    "finPrevue" TIMESTAMP(3),
    "finReelle" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingPause_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrainingPause_userId_debut_idx" ON "TrainingPause"("userId", "debut");

CREATE INDEX "TrainingPause_userId_finReelle_idx" ON "TrainingPause"("userId", "finReelle");

ALTER TABLE "TrainingPause" ADD CONSTRAINT "TrainingPause_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
