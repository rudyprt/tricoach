-- CreateTable
CREATE TABLE "ConsentementJournal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "objet" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentementJournal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentementJournal_userId_objet_createdAt_idx" ON "ConsentementJournal"("userId", "objet", "createdAt");

-- AddForeignKey
ALTER TABLE "ConsentementJournal" ADD CONSTRAINT "ConsentementJournal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reprise de l'existant : les accords déjà donnés, à leur date, avec le texte
-- alors affiché (version 2026-09).
INSERT INTO "ConsentementJournal" ("id", "userId", "objet", "action", "version", "createdAt")
SELECT 'reprise_sante_' || "id", "userId", 'sante', 'donne', '2026-09', "consentSanteAt"
FROM "AthleteProfile" WHERE "consentSanteAt" IS NOT NULL;

INSERT INTO "ConsentementJournal" ("id", "userId", "objet", "action", "version", "createdAt")
SELECT 'reprise_conditions_' || "id", "id", 'conditions', 'donne', "consentVersion", "consentAcceptedAt"
FROM "User" WHERE "consentAcceptedAt" IS NOT NULL AND "consentVersion" IS NOT NULL;
