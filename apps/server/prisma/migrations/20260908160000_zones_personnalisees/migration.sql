-- Zones d'allures corrigées à la main par l'athlète.
-- Une valeur presente ici prime sur le calcul automatique issu des temps de reference.
ALTER TABLE "AthleteProfile" ADD COLUMN "customZones" JSONB;
