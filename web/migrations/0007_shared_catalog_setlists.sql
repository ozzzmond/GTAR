-- Additive, environment-local only. No backfill; operator approval required.
-- All retained snapshots (including tombstones' history) count toward quotas.
CREATE TABLE catalog_setlist_heads (
  id TEXT PRIMARY KEY NOT NULL,
  publisher_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  publication_key TEXT NOT NULL CHECK(length(publication_key) BETWEEN 16 AND 128),
  current_revision INTEGER NOT NULL CHECK(current_revision >= 1),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK(is_deleted IN (0,1)),
  deleted_at TEXT,
  deleted_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  CHECK((is_deleted = 0 AND deleted_at IS NULL AND deleted_by_user_id IS NULL) OR
        (is_deleted = 1 AND deleted_at IS NOT NULL AND deleted_by_user_id IS NOT NULL)),
  UNIQUE(publisher_user_id, publication_key)
);

-- This is both the immutable revision content and permanent idempotency ledger.
-- No expiry: an old key can never become a new publication after unpublish.
CREATE TABLE catalog_setlist_mutations (
  id INTEGER PRIMARY KEY,
  editor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),
  request_digest TEXT NOT NULL CHECK(length(request_digest) = 64),
  operation TEXT NOT NULL CHECK(operation IN ('create','update','unpublish')),
  setlist_id TEXT NOT NULL,
  publication_key TEXT NOT NULL CHECK(length(publication_key) BETWEEN 16 AND 128),
  expected_revision INTEGER NOT NULL CHECK(expected_revision >= 0),
  source_version INTEGER,
  source_checksum TEXT,
  snapshot_json TEXT,
  snapshot_bytes INTEGER NOT NULL CHECK(snapshot_bytes BETWEEN 0 AND 262144),
  created_at TEXT NOT NULL,
  UNIQUE(editor_user_id, idempotency_key),
  CHECK(coalesce((operation = 'unpublish' AND snapshot_json IS NULL AND snapshot_bytes = 0
          AND source_version IS NULL AND source_checksum IS NULL AND expected_revision > 0) OR
        (operation IN ('create','update') AND source_version > 0 AND source_checksum IS NOT NULL
          AND snapshot_json IS NOT NULL AND json_valid(snapshot_json)
          AND snapshot_bytes = length(CAST(snapshot_json AS BLOB))
          AND json_extract(snapshot_json, '$.version') = 1
          AND json_type(snapshot_json, '$.name') = 'text'
          AND length(json_extract(snapshot_json, '$.name')) BETWEEN 1 AND 200
          AND json_type(snapshot_json, '$.entries') = 'array'
          AND json_array_length(snapshot_json, '$.entries') BETWEEN 1 AND 100), 0)),
  CHECK((operation = 'create' AND expected_revision = 0) OR
        (operation <> 'create' AND expected_revision > 0))
);
CREATE INDEX catalog_setlist_mutations_owner ON catalog_setlist_mutations(editor_user_id);
CREATE TABLE catalog_setlist_revisions (
  setlist_id TEXT NOT NULL REFERENCES catalog_setlist_heads(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  mutation_id INTEGER NOT NULL UNIQUE REFERENCES catalog_setlist_mutations(id) ON DELETE RESTRICT,
  PRIMARY KEY(setlist_id, revision)
);
-- One bounded row per approved caller; attempts, including retries, consume budget.
CREATE TABLE catalog_setlist_rates (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('read','write')),
  minute INTEGER NOT NULL,
  minute_count INTEGER NOT NULL CHECK(minute_count BETWEEN 1 AND 120),
  day INTEGER NOT NULL,
  day_count INTEGER NOT NULL CHECK(day_count BETWEEN 1 AND 10000),
  PRIMARY KEY(user_id, kind)
);

CREATE TRIGGER catalog_setlist_guard BEFORE INSERT ON catalog_setlist_mutations
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id = NEW.editor_user_id
    AND role IN ('admin', 'member') AND access_status = 'active') THEN RAISE(ABORT,'SETLIST_FORBIDDEN') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM catalog_setlist_mutations
    WHERE editor_user_id = NEW.editor_user_id AND idempotency_key = NEW.idempotency_key
    AND request_digest <> NEW.request_digest) THEN RAISE(ABORT,'SETLIST_IDEMPOTENCY') END;
END;

-- Guards and dependent writes execute inside ONE SQLite statement. RAISE(ABORT)
-- rolls back that statement, including trigger effects; no zero-row CAS success.
CREATE TRIGGER catalog_setlist_apply AFTER INSERT ON catalog_setlist_mutations
BEGIN
  SELECT CASE WHEN NEW.operation <> 'unpublish' AND NOT EXISTS(
    SELECT 1 FROM user_songbooks WHERE user_id = NEW.editor_user_id
      AND version = NEW.source_version AND checksum = NEW.source_checksum)
    THEN RAISE(ABORT,'SETLIST_SOURCE_CONFLICT') END;
  SELECT CASE WHEN NEW.operation = 'create' AND EXISTS(SELECT 1 FROM catalog_setlist_heads
    WHERE publisher_user_id = NEW.editor_user_id AND publication_key = NEW.publication_key)
    THEN RAISE(ABORT,'SETLIST_PUBLICATION_CONFLICT') END;
  SELECT CASE WHEN NEW.operation <> 'create' AND NOT EXISTS(SELECT 1 FROM catalog_setlist_heads
    WHERE id = NEW.setlist_id AND publisher_user_id = NEW.editor_user_id
      AND publication_key = NEW.publication_key AND current_revision = NEW.expected_revision AND is_deleted = 0)
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
  UPDATE catalog_setlist_heads SET current_revision = NEW.expected_revision + 1,
    is_deleted = CASE WHEN NEW.operation = 'unpublish' THEN 1 ELSE 0 END,
    deleted_at = CASE WHEN NEW.operation = 'unpublish' THEN NEW.created_at ELSE NULL END,
    deleted_by_user_id = CASE WHEN NEW.operation = 'unpublish' THEN NEW.editor_user_id ELSE NULL END
    WHERE NEW.operation <> 'create' AND id = NEW.setlist_id AND publisher_user_id = NEW.editor_user_id
      AND current_revision = NEW.expected_revision AND is_deleted = 0;
  INSERT INTO catalog_setlist_revisions(setlist_id,revision,mutation_id)
    VALUES(NEW.setlist_id,NEW.expected_revision + 1,NEW.id);
END;
CREATE TRIGGER catalog_setlist_mutation_no_update BEFORE UPDATE ON catalog_setlist_mutations
BEGIN SELECT RAISE(ABORT,'SETLIST_IMMUTABLE'); END;
CREATE TRIGGER catalog_setlist_mutation_no_delete BEFORE DELETE ON catalog_setlist_mutations
BEGIN SELECT RAISE(ABORT,'SETLIST_IMMUTABLE'); END;
CREATE TRIGGER catalog_setlist_revision_no_update BEFORE UPDATE ON catalog_setlist_revisions
BEGIN SELECT RAISE(ABORT,'SETLIST_IMMUTABLE'); END;
CREATE TRIGGER catalog_setlist_revision_no_delete BEFORE DELETE ON catalog_setlist_revisions
BEGIN SELECT RAISE(ABORT,'SETLIST_IMMUTABLE'); END;
CREATE TRIGGER catalog_setlist_head_no_delete BEFORE DELETE ON catalog_setlist_heads
BEGIN SELECT RAISE(ABORT,'SETLIST_TOMBSTONE'); END;
CREATE TRIGGER catalog_setlist_head_guard BEFORE UPDATE ON catalog_setlist_heads
BEGIN
  SELECT CASE WHEN OLD.is_deleted = 1 OR NEW.id <> OLD.id OR
    NEW.publisher_user_id <> OLD.publisher_user_id OR NEW.publication_key <> OLD.publication_key OR
    NEW.current_revision <> OLD.current_revision + 1
    THEN RAISE(ABORT,'SETLIST_TOMBSTONE') END;
END;
