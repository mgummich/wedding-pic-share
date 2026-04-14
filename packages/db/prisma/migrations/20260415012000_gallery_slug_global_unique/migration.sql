-- Enforce global gallery slug uniqueness to align guest route lookups by slug.
CREATE UNIQUE INDEX "Gallery_slug_key" ON "Gallery"("slug");
DROP INDEX "Gallery_weddingId_slug_key";
