-- Verification de l'adresse e-mail et consentement aux conditions.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "consentAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "consentVersion" TEXT;

-- Les comptes existants sont consideres comme ayant deja accepte les
-- conditions en vigueur lors de leur inscription : on ne peut pas leur
-- redemander retroactivement, et les bloquer serait disproportionne.
UPDATE "User" SET "consentAcceptedAt" = "createdAt", "consentVersion" = 'heritee' WHERE "consentAcceptedAt" IS NULL;

CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
