-- Connexion au compte Strava d'un athlete.
CREATE TABLE "StravaAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "athleteName" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StravaAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StravaAccount_userId_key" ON "StravaAccount"("userId");
CREATE UNIQUE INDEX "StravaAccount_athleteId_key" ON "StravaAccount"("athleteId");

ALTER TABLE "StravaAccount" ADD CONSTRAINT "StravaAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Activites reellement effectuees, importees depuis une source externe.
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'strava',
    "sport" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "dureeMin" INTEGER NOT NULL,
    "distanceKm" DOUBLE PRECISION,
    "denivelePosM" INTEGER,
    "fcMoyenne" INTEGER,
    "fcMax" INTEGER,
    "puissanceMoy" INTEGER,
    "allureSecParKm" INTEGER,
    "sessionId" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Activity_source_externalId_key" ON "Activity"("source", "externalId");
CREATE INDEX "Activity_userId_startedAt_idx" ON "Activity"("userId", "startedAt");

ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
