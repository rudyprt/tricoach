-- Rappels par e-mail, et trace des envois pour ne jamais envoyer deux fois le
-- meme message au meme athlete.
ALTER TABLE "User" ADD COLUMN "rappelsEmail" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Reminder_userId_kind_periode_key" ON "Reminder"("userId", "kind", "periode");

CREATE INDEX "Reminder_userId_sentAt_idx" ON "Reminder"("userId", "sentAt");

ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
