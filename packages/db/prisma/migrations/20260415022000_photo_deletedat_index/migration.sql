-- Improve soft-delete query performance.
CREATE INDEX "Photo_galleryId_deletedAt_status_createdAt_idx" ON "Photo"("galleryId", "deletedAt", "status", "createdAt" DESC);
