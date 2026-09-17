-- Creneaux d'entrainement jour par jour, et materiel dont dispose l'athlete.
-- Sans eux, le coach programme des seances irrealisables : une sortie longue un
-- soir de semaine, ou de la natation sans acces a un bassin.
ALTER TABLE "AthleteProfile" ADD COLUMN "disponibilites" JSONB;
ALTER TABLE "AthleteProfile" ADD COLUMN "materiel" JSONB;
