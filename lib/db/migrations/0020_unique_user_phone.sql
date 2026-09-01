-- Canonicalize legacy user phones before enforcing uniqueness.
-- Local values are interpreted as Cyprus numbers, matching the account
-- control's default country. Values outside the supported account countries
-- or with ambiguous/invalid lengths abort the migration rather than being
-- discarded or assigned to an arbitrary account.
CREATE OR REPLACE FUNCTION pg_temp.normalize_legacy_user_phone(input text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  trimmed text := btrim(input);
  digits text := regexp_replace(input, '[^0-9]', '', 'g');
  candidate text;
BEGIN
  IF trimmed !~ '^(?:\+|00)?[0-9][0-9 ()-]*$' THEN
    RETURN NULL;
  END IF;

  IF trimmed ~ '^00' THEN
    digits := substring(digits FROM 3);
    candidate := '+' || digits;
  ELSIF trimmed ~ '^\+' THEN
    candidate := '+' || digits;
  ELSIF digits ~ '^[1-9][0-9]{7}$' THEN
    candidate := '+357' || digits;
  ELSE
    RETURN NULL;
  END IF;

  IF candidate ~ '^\+357[1-9][0-9]{7}$'
     OR candidate ~ '^\+30[1-9][0-9]{9}$'
     OR candidate ~ '^\+44[1-9][0-9]{9}$'
     OR candidate ~ '^\+1[1-9][0-9]{9}$'
     OR candidate ~ '^\+61[1-9][0-9]{8}$'
     OR candidate ~ '^\+49[1-9][0-9]{9}$'
     OR candidate ~ '^\+33[1-9][0-9]{8}$'
     OR candidate ~ '^\+39[1-9][0-9]{9}$'
     OR candidate ~ '^\+34[1-9][0-9]{8}$'
  THEN
    RETURN candidate;
  END IF;

  RETURN NULL;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  invalid_phone text;
  duplicate_phone text;
BEGIN
  SELECT phone_number
    INTO invalid_phone
    FROM users
   WHERE phone_number IS NOT NULL
     AND pg_temp.normalize_legacy_user_phone(phone_number) IS NULL
   LIMIT 1;

  IF invalid_phone IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy user phone values need manual reconciliation';
  END IF;

  SELECT normalized_phone
    INTO duplicate_phone
    FROM (
      SELECT pg_temp.normalize_legacy_user_phone(phone_number) AS normalized_phone
        FROM users
       WHERE phone_number IS NOT NULL
    ) normalized
   GROUP BY normalized_phone
  HAVING count(*) > 1
   LIMIT 1;

  IF duplicate_phone IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate legacy user phones need manual reconciliation';
  END IF;

  UPDATE users
     SET phone_number = pg_temp.normalize_legacy_user_phone(phone_number)
   WHERE phone_number IS NOT NULL
     AND phone_number <> pg_temp.normalize_legacy_user_phone(phone_number);
END $$;
--> statement-breakpoint

-- NULL remains allowed for pre-existing legacy accounts without a phone.
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_number_unique" ON "users" ("phone_number")
WHERE "phone_number" IS NOT NULL;