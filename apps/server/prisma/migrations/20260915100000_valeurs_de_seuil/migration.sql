-- Valeurs de seuil connues de l'athlete. Une valeur saisie ici prime sur toute
-- estimation tiree d'un temps de reference.
ALTER TABLE "AthleteProfile" ADD COLUMN "seuilCourseSecParKm" INTEGER;
ALTER TABLE "AthleteProfile" ADD COLUMN "cssSecPer100m" INTEGER;
ALTER TABLE "AthleteProfile" ADD COLUMN "fcSeuil" INTEGER;
ALTER TABLE "AthleteProfile" ADD COLUMN "fcMax" INTEGER;
