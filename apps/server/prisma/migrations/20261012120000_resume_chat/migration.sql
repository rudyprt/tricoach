-- CreateTable
CREATE TABLE "ResumeChat" (
    "userId" TEXT NOT NULL,
    "texte" TEXT NOT NULL,
    "jusquA" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeChat_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "ResumeChat" ADD CONSTRAINT "ResumeChat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
