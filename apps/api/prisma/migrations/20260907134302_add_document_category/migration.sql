-- Additive migration (Checkpoint 9): document category, used by the
-- investigation-completeness check ("Site Plan missing", "Survey missing").
ALTER TABLE "Document" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'Other';
