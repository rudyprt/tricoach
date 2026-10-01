-- Fréquence cardiaque au seuil, par discipline.
--
-- Une seule valeur servait aux trois, et le test de vélo l'écrasait : passer un
-- test FTP abaissait les zones cardiaques de course de cinq à dix battements.
-- Les colonnes restent nulles tant qu'aucune mesure propre n'existe ; les zones
-- sont alors estimées depuis la course, et annoncées comme telles.
ALTER TABLE "AthleteProfile" ADD COLUMN "fcSeuilVelo" INTEGER;
ALTER TABLE "AthleteProfile" ADD COLUMN "fcSeuilNatation" INTEGER;
