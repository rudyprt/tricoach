-- Compteur de limitation de debit partage entre les instances. Le compteur en
-- memoire autorise le quota entier par instance : la protection contre le
-- bourrage de mots de passe doublerait des qu'on ajoute un serveur.
CREATE TABLE "RateLimitCounter" (
    "id" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RateLimitCounter_expiresAt_idx" ON "RateLimitCounter"("expiresAt");
