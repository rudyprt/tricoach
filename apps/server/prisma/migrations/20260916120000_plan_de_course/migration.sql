-- Plan de course : allures, nutrition, hydratation, transitions. Sur un half ou
-- un Ironman, c'est la nutrition qui fait abandonner, pas l'entrainement.
ALTER TABLE "Race" ADD COLUMN "planCourse" JSONB;
ALTER TABLE "Race" ADD COLUMN "planGenereLe" TIMESTAMP(3);
