-- AlterTable
ALTER TABLE "Gallery" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "UploadWindow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "galleryId" TEXT NOT NULL,
    "start" DATETIME NOT NULL,
    "end" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadWindow_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "Gallery" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "UploadWindow_galleryId_start_end_idx" ON "UploadWindow"("galleryId", "start", "end");
