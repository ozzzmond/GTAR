-- Migration 0008: Allow active GTAR members and admins to mutate catalog setlists
DROP TRIGGER IF EXISTS catalog_setlist_guard;

CREATE TRIGGER catalog_setlist_guard BEFORE INSERT ON catalog_setlist_mutations
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id = NEW.editor_user_id
    AND role IN ('admin', 'member') AND access_status = 'active') THEN RAISE(ABORT,'SETLIST_FORBIDDEN') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM catalog_setlist_mutations
    WHERE editor_user_id = NEW.editor_user_id AND idempotency_key = NEW.idempotency_key
    AND request_digest <> NEW.request_digest) THEN RAISE(ABORT,'SETLIST_IDEMPOTENCY') END;
END;
