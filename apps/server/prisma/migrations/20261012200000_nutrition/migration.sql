-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "nutritionPrise" JSONB;

-- CreateTable
CREATE TABLE "ProfilNutrition" (
    "userId" TEXT NOT NULL,
    "poidsKg" DOUBLE PRECISION,
    "formats" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cafeine" BOOLEAN NOT NULL DEFAULT false,
    "sueurSalee" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfilNutrition_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "TestSudation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sport" TEXT NOT NULL,
    "dureeMin" INTEGER NOT NULL,
    "poidsAvantKg" DOUBLE PRECISION NOT NULL,
    "poidsApresKg" DOUBLE PRECISION NOT NULL,
    "boissonMl" INTEGER NOT NULL DEFAULT 0,
    "temperatureC" INTEGER,
    "tauxMlH" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestSudation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestSudation_userId_date_idx" ON "TestSudation"("userId", "date");

-- AddForeignKey
ALTER TABLE "ProfilNutrition" ADD CONSTRAINT "ProfilNutrition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSudation" ADD CONSTRAINT "TestSudation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
