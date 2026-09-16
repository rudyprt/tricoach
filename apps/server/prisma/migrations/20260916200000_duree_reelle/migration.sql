-- Duree reellement effectuee, quand elle differe du prevu. Corriger une seance
-- passee n'etait possible qu'en important un fichier de montre.
ALTER TABLE "Session" ADD COLUMN "dureeReelleMin" INTEGER;
