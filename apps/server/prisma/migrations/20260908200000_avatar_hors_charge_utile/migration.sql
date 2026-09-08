-- L'avatar n'est plus renvoye dans chaque reponse : seule sa date de mise a
-- jour l'est, et l'image est servie par une route dediee et mise en cache.
ALTER TABLE "User" ADD COLUMN "avatarUpdatedAt" TIMESTAMP(3);

-- Les photos deja enregistrees doivent rester visibles.
UPDATE "User" SET "avatarUpdatedAt" = "createdAt" WHERE "avatarUrl" IS NOT NULL;
