-- 021_extensions_in_public.sql
-- Extensions live in `public`, where every role can see their types (production readiness).
--
-- 001 creates `citext` and `pgcrypto` without naming a schema. Applied by Docker's first
-- start (development) they land in `public`; applied by the migration runner (every fresh
-- production database) they landed in `pmp` — and `pmp_app`, whose search path is
-- "$user", public, then cannot resolve the type: the first-admin bootstrap failed with
-- `type "citext" does not exist`. Moving an extension moves its types and functions;
-- columns already using them keep working (they refer to the type, not its name).
DO $$
DECLARE
  ext text;
BEGIN
  FOREACH ext IN ARRAY ARRAY['citext', 'pgcrypto'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
       WHERE e.extname = ext AND n.nspname <> 'public'
    ) THEN
      EXECUTE format('ALTER EXTENSION %I SET SCHEMA public', ext);
    END IF;
  END LOOP;
END $$;
