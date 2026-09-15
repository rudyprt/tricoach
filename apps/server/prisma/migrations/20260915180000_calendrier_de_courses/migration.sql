-- Calendrier de courses. Un triathlete cible une course principale et en court
-- d'autres en chemin : les priorites A / B / C decident de l'affutage.
CREATE TABLE "Race" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'autre',
    "priorite" TEXT NOT NULL DEFAULT 'A',
    "lieu" TEXT NOT NULL DEFAULT '',
    "objectifTemps" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Race_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Race_userId_date_idx" ON "Race"("userId", "date");

ALTER TABLE "Race" ADD CONSTRAINT "Race_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reprise de l'objectif deja saisi dans le profil : sans cela, les athletes
-- existants se retrouveraient avec un calendrier vide alors qu'ils preparent
-- bien une course.
INSERT INTO "Race" ("id", "userId", "nom", "date", "format", "priorite", "lieu", "objectifTemps", "createdAt")
SELECT
    'race_' || "id",
    "userId",
    "objectif",
    "objectifDate",
    'autre',
    'A',
    '',
    '',
    CURRENT_TIMESTAMP
FROM "AthleteProfile"
WHERE "objectif" <> '';
