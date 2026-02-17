BEGIN TRANSACTION;

ALTER TABLE users ADD COLUMN display_name TEXT;

UPDATE users
SET display_name = (
  SELECT contacts.name
  FROM contacts
  WHERE contacts.email = users.email
)
WHERE display_name IS NULL
  AND EXISTS (
    SELECT 1 FROM contacts WHERE contacts.email = users.email
  );

COMMIT;
