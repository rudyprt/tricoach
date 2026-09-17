-- Tests de terrain programmes par le coach, et resultats servant a reajuster
-- les zones. Sans eux, les zones restent figees sur un temps declare a
-- l'inscription.
CREATE TABLE "FitnessTest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planifie',
    "distanceM" INTEGER,
    "puissanceMoy" INTEGER,
    "temps400S" INTEGER,
    "temps200S" INTEGER,
    "fcMoyenne" INTEGER,
    "resume" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FitnessTest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FitnessTest_userId_scheduledFor_idx" ON "FitnessTest"("userId", "scheduledFor");

CREATE INDEX "FitnessTest_userId_sport_status_idx" ON "FitnessTest"("userId", "sport", "status");

ALTER TABLE "FitnessTest" ADD CONSTRAINT "FitnessTest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
