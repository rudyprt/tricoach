-- Consentement explicite au traitement des données de santé.
--
-- Les profils existants portent peut-être déjà des contraintes saisies avant
-- que ce consentement n'existe. On ne peut pas le présumer : la colonne reste
-- nulle, et l'athlète devra cocher la case pour conserver ce qu'il a écrit.
ALTER TABLE "AthleteProfile" ADD COLUMN "consentSanteAt" TIMESTAMP(3);
