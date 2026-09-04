-- Blades Privé · paso 1.2 del plan de lanzamiento
-- Correr en el editor SQL de Supabase ANTES de la migración.
--
-- Son seis, no cuatro: featured_note_es y featured_note_en las usan las
-- cuatro fragancias con nota del curador, y si no existen PostgREST
-- rechaza el lote entero en el que viajan.

alter table perfumes
  add column if not exists concentration    text,
  add column if not exists size_ml          numeric,
  add column if not exists size_g           numeric,
  add column if not exists gender           text,
  add column if not exists featured_note_es text,
  add column if not exists featured_note_en text;
