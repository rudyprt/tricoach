-- AlterTable
ALTER TABLE "User" ADD COLUMN     "abonnementAnnulationPrevue" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "abonnementFinPeriode" TIMESTAMP(3),
ADD COLUMN     "abonnementStatut" TEXT,
ADD COLUMN     "accesImmediatDemandeLe" TIMESTAMP(3),
ADD COLUMN     "conditionsVenteAccepteesLe" TIMESTAMP(3),
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeSubscriptionId_key" ON "User"("stripeSubscriptionId");
