-- Protection anti-bourrage attachee au compte plutot qu'a l'adresse IP :
-- elle reste efficace derriere plusieurs instances ou plusieurs adresses.
ALTER TABLE "User" ADD COLUMN "failedLogins" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);
