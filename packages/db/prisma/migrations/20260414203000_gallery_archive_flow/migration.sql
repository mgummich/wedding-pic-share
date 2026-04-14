-- AlterTable
ALTER TABLE "Gallery" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Gallery" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "Gallery" ADD COLUMN "archivePath" TEXT;
ALTER TABLE "Gallery" ADD COLUMN "archiveSizeBytes" INTEGER;
