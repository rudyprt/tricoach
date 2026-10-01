-- Avertissement avant suppression d'un compte resté inactif.
ALTER TABLE "User" ADD COLUMN "purgeAvertieLe" TIMESTAMP(3);
