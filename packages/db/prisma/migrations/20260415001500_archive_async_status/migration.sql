-- AlterTable
ALTER TABLE "Gallery" ADD COLUMN "archiveStatus" TEXT NOT NULL DEFAULT 'IDLE';
ALTER TABLE "Gallery" ADD COLUMN "archiveError" TEXT;
ALTER TABLE "Gallery" ADD COLUMN "archiveRequestedAt" DATETIME;
