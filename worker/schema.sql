-- MPPT Journal — Editorial Workflow D1 Schema
-- Database: mppt-editorial
-- Created: 2026-09-17

-- ============================================================
-- MANUSCRIPTS — Core paper tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS manuscripts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id        TEXT    NOT NULL UNIQUE,          -- MPPT-2026-V1I1-0001
  title           TEXT    NOT NULL DEFAULT '',
  abstract        TEXT    DEFAULT '',
  keywords        TEXT    DEFAULT '',               -- semicolon-separated
  -- Author info
  author_name     TEXT    NOT NULL,
  author_email    TEXT    NOT NULL,
  author_affiliation TEXT DEFAULT '',
  author_orcid    TEXT    DEFAULT '',
  coauthors       TEXT    DEFAULT '',               -- JSON array
  -- Submission metadata
  subject_scope   TEXT    DEFAULT '',               -- pharmacology, pharmaceutics, etc.
  article_type    TEXT    DEFAULT 'research',        -- research, review, case_report, short_comm
  volume          INTEGER DEFAULT 1,
  issue           INTEGER DEFAULT 1,
  -- Workflow state
  stage           TEXT    NOT NULL DEFAULT 'SUBMITTED',
  -- SUBMITTED → PLAGIARISM_CHECK → PLAGIARISM_FAIL → PLAGIARISM_PASS
  -- → FORMATTING_CHECK → FORMATTING_FAIL → FORMATTING_PASS
  -- → REVIEWER_ASSIGNED → UNDER_REVIEW → REVISION_REQUIRED → REVISION_SUBMITTED
  -- → ACCEPTED → GALLERY_SENT → GALLERY_CONFIRMED
  -- → PAYMENT_PENDING → PAYMENT_VERIFIED
  -- → PUBLISHED → ARCHIVED
  -- → REJECTED (terminal)
  stage_history   TEXT    DEFAULT '[]',             -- JSON array of {stage, timestamp, actor}
  -- Plagiarism
  plagiarism_score      REAL    DEFAULT NULL,
  ai_content_score      REAL    DEFAULT NULL,
  plagiarism_attempts   INTEGER DEFAULT 0,
  -- Deadlines
  current_deadline      TEXT    DEFAULT NULL,       -- ISO timestamp
  deadline_type         TEXT    DEFAULT NULL,       -- resubmit_plagiarism, resubmit_format, reviewer_response, revision, gallery_confirm, payment
  -- Payment
  razorpay_payment_id   TEXT    DEFAULT NULL,
  razorpay_order_id     TEXT    DEFAULT NULL,
  payment_amount        REAL    DEFAULT NULL,
  payment_verified      INTEGER DEFAULT 0,
  -- Publication
  published_url         TEXT    DEFAULT NULL,
  zenodo_doi            TEXT    DEFAULT NULL,
  zenodo_record_id      TEXT    DEFAULT NULL,
  certificate_url       TEXT    DEFAULT NULL,
  -- R2 storage
  r2_folder             TEXT    DEFAULT NULL,       -- manuscripts/MPPT-2026-V1I1-0001/
  original_filename     TEXT    DEFAULT NULL,
  -- Flags
  email_subscribed      INTEGER DEFAULT 1,          -- author opted into email updates
  is_active             INTEGER DEFAULT 1,          -- 0 = soft deleted
  -- Timestamps
  submitted_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  published_at          TEXT    DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_manuscripts_stage ON manuscripts(stage);
CREATE INDEX IF NOT EXISTS idx_manuscripts_paper_id ON manuscripts(paper_id);
CREATE INDEX IF NOT EXISTS idx_manuscripts_author_email ON manuscripts(author_email);
CREATE INDEX IF NOT EXISTS idx_manuscripts_deadline ON manuscripts(current_deadline);

-- ============================================================
-- REVIEWERS — Reviewer pool
-- ============================================================
CREATE TABLE IF NOT EXISTS reviewers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  email           TEXT    NOT NULL UNIQUE,
  affiliation     TEXT    DEFAULT '',
  speciality      TEXT    DEFAULT '',               -- scope keywords, semicolon-separated
  orcid           TEXT    DEFAULT '',
  is_active       INTEGER DEFAULT 1,
  total_assigned  INTEGER DEFAULT 0,
  total_completed INTEGER DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reviewers_active ON reviewers(is_active);
CREATE INDEX IF NOT EXISTS idx_reviewers_speciality ON reviewers(speciality);

-- ============================================================
-- REVIEW_ASSIGNMENTS — Paper ↔ Reviewer mapping
-- ============================================================
CREATE TABLE IF NOT EXISTS review_assignments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id        TEXT    NOT NULL,
  reviewer_id     INTEGER NOT NULL,
  -- State
  status          TEXT    NOT NULL DEFAULT 'INVITED',
  -- INVITED → ACCEPTED → REVIEW_SUBMITTED → COMPLETED
  -- → DECLINED → NO_RESPONSE → REASSIGNED
  decision        TEXT    DEFAULT NULL,             -- accept, minor_revision, major_revision, reject
  comments        TEXT    DEFAULT '',               -- reviewer's comments text
  comments_file   TEXT    DEFAULT NULL,             -- R2 key for uploaded review file
  -- Dates
  invited_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  deadline        TEXT    DEFAULT NULL,             -- 10 days from invite
  last_reminder   TEXT    DEFAULT NULL,
  reminder_count  INTEGER DEFAULT 0,
  responded_at    TEXT    DEFAULT NULL,
  completed_at    TEXT    DEFAULT NULL,
  FOREIGN KEY (paper_id) REFERENCES manuscripts(paper_id),
  FOREIGN KEY (reviewer_id) REFERENCES reviewers(id)
);

CREATE INDEX IF NOT EXISTS idx_assignments_paper ON review_assignments(paper_id);
CREATE INDEX IF NOT EXISTS idx_assignments_reviewer ON review_assignments(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON review_assignments(status);

-- ============================================================
-- COMMUNICATIONS — Full audit trail of all emails + Telegram messages
-- ============================================================
CREATE TABLE IF NOT EXISTS communications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id        TEXT    DEFAULT NULL,
  channel         TEXT    NOT NULL,                 -- email, telegram, system
  direction       TEXT    NOT NULL DEFAULT 'outbound', -- outbound, inbound
  from_address    TEXT    DEFAULT '',               -- email address or telegram user
  to_address      TEXT    DEFAULT '',               -- recipient email or group
  subject         TEXT    DEFAULT '',
  body_preview    TEXT    DEFAULT '',               -- first 500 chars
  r2_key          TEXT    DEFAULT NULL,             -- full email body stored in R2
  template_used   TEXT    DEFAULT NULL,             -- which HTML template
  stage_at_time   TEXT    DEFAULT NULL,             -- paper stage when sent
  sent_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (paper_id) REFERENCES manuscripts(paper_id)
);

CREATE INDEX IF NOT EXISTS idx_comms_paper ON communications(paper_id);
CREATE INDEX IF NOT EXISTS idx_comms_channel ON communications(channel);

-- ============================================================
-- SCHEDULED_TASKS — Deadline alerts, reminders, escalations
-- ============================================================
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id        TEXT    NOT NULL,
  task_type       TEXT    NOT NULL,                 -- deadline_alert, reviewer_reminder, escalation
  target_email    TEXT    DEFAULT NULL,             -- who to alert
  fire_at         TEXT    NOT NULL,                 -- ISO timestamp when this should fire
  fired           INTEGER DEFAULT 0,               -- 1 = already executed
  result          TEXT    DEFAULT NULL,             -- outcome after firing
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (paper_id) REFERENCES manuscripts(paper_id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_fire ON scheduled_tasks(fire_at, fired);
CREATE INDEX IF NOT EXISTS idx_tasks_paper ON scheduled_tasks(paper_id);

-- ============================================================
-- COUNTERS — For generating sequential paper IDs
-- ============================================================
CREATE TABLE IF NOT EXISTS counters (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  counter_key     TEXT    NOT NULL UNIQUE,          -- e.g. 'paper_seq_V1I1'
  counter_value   INTEGER NOT NULL DEFAULT 0
);

-- Initialize the first volume/issue counter
INSERT OR IGNORE INTO counters (counter_key, counter_value) VALUES ('paper_seq_V1I1', 0);
