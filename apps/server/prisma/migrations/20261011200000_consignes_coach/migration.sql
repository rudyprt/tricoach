-- CreateTable
CREATE TABLE "ConsigneCoach" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "texte" TEXT NOT NULL,
    "jusquAu" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsigneCoach_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsigneCoach_userId_createdAt_idx" ON "ConsigneCoach"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConsigneCoach" ADD CONSTRAINT "ConsigneCoach_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
