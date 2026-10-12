-- AlterTable
ALTER TABLE "Race" ADD COLUMN     "discipline" TEXT NOT NULL DEFAULT 'triathlon',
ADD COLUMN     "distanceKm" DOUBLE PRECISION;
