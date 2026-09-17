-- Partage en lecture seule d'une semaine, pour la montrer a un coach humain ou
-- a un partenaire d'entrainement. Seul le hash du jeton est conserve.
CREATE TABLE "SharedWeek" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "vues" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedWeek_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SharedWeek_tokenHash_key" ON "SharedWeek"("tokenHash");

CREATE INDEX "SharedWeek_userId_weekStart_idx" ON "SharedWeek"("userId", "weekStart");

ALTER TABLE "SharedWeek" ADD CONSTRAINT "SharedWeek_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
