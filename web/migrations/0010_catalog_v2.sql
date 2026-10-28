-- Migration 0010: Catalog V2 (#253)
-- 1. Client-submitted setlist snapshots (source_kind = 'client') no longer need a personal
--    cloud user_songbooks record. Legacy rows and legacy clients keep source_kind = 'songbook'
--    and the exact user_songbooks version/checksum validation.
-- 2. Active admins may update/unpublish any published setlist. publisher_user_id stays
--    immutable (catalog_setlist_head_guard is unchanged); editor_user_id records the actor.
-- 3. Reactive catalog_reports with an admin resolution queue. No auto-hide, no approval queue.
--
-- Unchanged guarantees: catalog_setlist_guard (0008), mutation/revision append-only triggers,
-- head tombstone/head guard triggers, idempotency ledger, quotas and revision CAS.
--
-- Rollback is forward-only (0011, prepared only if needed): DROP TRIGGER catalog_setlist_apply and
-- re-create it with the exact 0007 text. source_kind stays (all new rows remain valid, legacy
-- validation resumes for every new write) and catalog_reports stays as unused retained history.
-- No row is deleted or rewritten by this migration or by its rollback.

ALTER TABLE catalog_setlist_mutations ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'songbook'
  CHECK (source_kind IN ('songbook', 'client'));

DROP TRIGGER IF EXISTS catalog_setlist_apply;

-- Guards and dependent writes still execute inside ONE SQLite statement: RAISE(ABORT) rolls back
-- the mutation row and every trigger effect.
CREATE TRIGGER catalog_setlist_apply AFTER INSERT ON catalog_setlist_mutations
BEGIN
  -- Legacy path: exact personal cloud songbook version and checksum.
  SELECT CASE WHEN NEW.operation <> 'unpublish' AND NEW.source_kind = 'songbook' AND NOT EXISTS(
    SELECT 1 FROM user_songbooks WHERE user_id = NEW.editor_user_id
      AND version = NEW.source_version AND checksum = NEW.source_checksum)
    THEN RAISE(ABORT,'SETLIST_SOURCE_CONFLICT') END;
  -- Client path: version 1 and a lowercase SHA-256 hex of snapshot_json (computed by the server).
  SELECT CASE WHEN NEW.operation <> 'unpublish' AND NEW.source_kind = 'client' AND (
    NEW.source_version <> 1 OR length(NEW.source_checksum) <> 64 OR NEW.source_checksum GLOB '*[^0-9a-f]*')
    THEN RAISE(ABORT,'SETLIST_SOURCE_CONFLICT') END;
  SELECT CASE WHEN NEW.operation = 'unpublish' AND NEW.source_kind <> 'songbook'
    THEN RAISE(ABORT,'SETLIST_SOURCE_CONFLICT') END;
  SELECT CASE WHEN NEW.operation = 'create' AND EXISTS(SELECT 1 FROM catalog_setlist_heads
    WHERE publisher_user_id = NEW.editor_user_id AND publication_key = NEW.publication_key)
    THEN RAISE(ABORT,'SETLIST_PUBLICATION_CONFLICT') END;
  -- Another publisher's setlist: active admins only, and only through the client path (a legacy
  -- songbook source belongs to its publisher) or unpublish.
  SELECT CASE WHEN NEW.operation <> 'create' AND EXISTS(SELECT 1 FROM catalog_setlist_heads
    WHERE id = NEW.setlist_id AND publisher_user_id <> NEW.editor_user_id) AND (
      NOT EXISTS(SELECT 1 FROM users WHERE id = NEW.editor_user_id AND role = 'admin' AND access_status = 'active') OR
      (NEW.operation = 'update' AND NEW.source_kind = 'songbook'))
    THEN RAISE(ABORT,'SETLIST_FORBIDDEN') END;
  SELECT CASE WHEN NEW.operation <> 'create' AND NOT EXISTS(SELECT 1 FROM catalog_setlist_heads
    WHERE id = NEW.setlist_id AND publication_key = NEW.publication_key
      AND current_revision = NEW.expected_revision AND is_deleted = 0)
    THEN RAISE(ABORT,'SETLIST_REVISION_CONFLICT') END;
  SELECT CASE WHEN NEW.operation <> 'unpublish' AND (
    (SELECT count(*) FROM catalog_setlist_mutations WHERE editor_user_id = NEW.editor_user_id) > 10000 OR
    (SELECT count(*) FROM catalog_setlist_mutations) > 100000 OR
    (SELECT coalesce(sum(snapshot_bytes),0) FROM catalog_setlist_mutations WHERE editor_user_id = NEW.editor_user_id) > 16777216 OR
    (SELECT coalesce(sum(snapshot_bytes),0) FROM catalog_setlist_mutations) > 268435456 OR
    NEW.expected_revision >= 100 OR
    (NEW.operation = 'create' AND ((SELECT count(*) FROM catalog_setlist_heads WHERE publisher_user_id = NEW.editor_user_id) >= 100 OR
       (SELECT count(*) FROM catalog_setlist_heads) >= 1000)))
    THEN RAISE(ABORT,'SETLIST_QUOTA') END;

  INSERT INTO catalog_setlist_heads(id,publisher_user_id,publication_key,current_revision)
    SELECT NEW.setlist_id,NEW.editor_user_id,NEW.publication_key,1 WHERE NEW.operation = 'create';
  -- Authorization was proven above in this statement; the head's publisher is never changed.
  UPDATE catalog_setlist_heads SET current_revision = NEW.expected_revision + 1,
    is_deleted = CASE WHEN NEW.operation = 'unpublish' THEN 1 ELSE 0 END,
    deleted_at = CASE WHEN NEW.operation = 'unpublish' THEN NEW.created_at ELSE NULL END,
    deleted_by_user_id = CASE WHEN NEW.operation = 'unpublish' THEN NEW.editor_user_id ELSE NULL END
    WHERE NEW.operation <> 'create' AND id = NEW.setlist_id AND publication_key = NEW.publication_key
      AND current_revision = NEW.expected_revision AND is_deleted = 0;
  INSERT INTO catalog_setlist_revisions(setlist_id,revision,mutation_id)
    VALUES(NEW.setlist_id,NEW.expected_revision + 1,NEW.id);
END;

-- Reactive moderation. Reports are retained history: never deleted, resolved once by an admin.
CREATE TABLE catalog_reports (
  id INTEGER PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('song', 'setlist')),
  target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 128),
  target_revision INTEGER NOT NULL CHECK (target_revision >= 1),
  reporter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (reason IN ('copyright', 'wrong_content', 'spam_abuse', 'other')),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
  resolver_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  resolution_note TEXT CHECK (resolution_note IS NULL OR length(resolution_note) <= 500),
  created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  resolved_at TEXT,
  CHECK ((status = 'open' AND resolver_user_id IS NULL AND resolution_note IS NULL AND resolved_at IS NULL) OR
         (status <> 'open' AND resolver_user_id IS NOT NULL AND resolved_at IS NOT NULL))
);
-- One open report per reporter and target.
CREATE UNIQUE INDEX catalog_reports_one_open ON catalog_reports(reporter_user_id, target_kind, target_id)
  WHERE status = 'open';
CREATE INDEX catalog_reports_queue ON catalog_reports(status, created_at);
CREATE INDEX catalog_reports_target ON catalog_reports(target_kind, target_id);
CREATE INDEX catalog_reports_reporter ON catalog_reports(reporter_user_id, created_at);

CREATE TRIGGER catalog_report_guard BEFORE INSERT ON catalog_reports
BEGIN
  SELECT CASE WHEN NEW.status <> 'open' THEN RAISE(ABORT,'REPORT_INVALID') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id = NEW.reporter_user_id
    AND role IN ('admin', 'member') AND access_status = 'active') THEN RAISE(ABORT,'REPORT_FORBIDDEN') END;
  SELECT CASE WHEN (NEW.target_kind = 'song' AND NOT EXISTS(SELECT 1 FROM shared_catalog_songs
      WHERE id = NEW.target_id AND is_deleted = 0 AND current_revision >= NEW.target_revision)) OR
    (NEW.target_kind = 'setlist' AND NOT EXISTS(SELECT 1 FROM catalog_setlist_heads
      WHERE id = NEW.target_id AND is_deleted = 0 AND current_revision >= NEW.target_revision))
    THEN RAISE(ABORT,'REPORT_TARGET') END;
  SELECT CASE WHEN
    (SELECT count(*) FROM catalog_reports WHERE reporter_user_id = NEW.reporter_user_id
      AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at, '-1 hour')) >= 10 OR
    (SELECT count(*) FROM catalog_reports WHERE reporter_user_id = NEW.reporter_user_id
      AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at, '-1 day')) >= 30
    THEN RAISE(ABORT,'REPORT_RATE') END;
END;
CREATE TRIGGER catalog_report_resolve BEFORE UPDATE ON catalog_reports
BEGIN
  SELECT CASE WHEN OLD.status <> 'open' OR NEW.status = 'open' OR NEW.id <> OLD.id OR
    NEW.target_kind <> OLD.target_kind OR NEW.target_id <> OLD.target_id OR
    NEW.target_revision <> OLD.target_revision OR NEW.reporter_user_id <> OLD.reporter_user_id OR
    NEW.reason <> OLD.reason OR NEW.note IS NOT OLD.note OR NEW.created_at <> OLD.created_at OR
    NOT EXISTS(SELECT 1 FROM users WHERE id = NEW.resolver_user_id AND role = 'admin' AND access_status = 'active')
    THEN RAISE(ABORT,'REPORT_IMMUTABLE') END;
END;
CREATE TRIGGER catalog_report_no_delete BEFORE DELETE ON catalog_reports
BEGIN SELECT RAISE(ABORT,'REPORT_IMMUTABLE'); END;
