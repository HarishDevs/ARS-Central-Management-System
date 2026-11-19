-- v1.57.6 (D-348, owner, 19 Nov 2026, risks 5 and 6): background jobs count
-- their tries, so a run that crashed is recovered and retried a bounded
-- number of times instead of for ever (or never).
--   export_jobs.attempts      each claim (QUEUED -> RUNNING) adds one; it is
--                             also the claim's identity, so a stale run can't
--                             finish or fail a newer claim. After 3 tries the
--                             export is FAILED and its requester is told.
--   report_runs.attempts      1 for the first send of a slot; a run stopped by
--                             a crash (RUNNING over an hour) is FAILED and
--                             retried once (attempts 2).
--   hod_report_runs.attempts  the same for the weekly HOD report.
-- Additive: existing rows get 0 (exports) or 1 (runs). Run after 202611191100.
--
-- Rollback (after rolling the code back):
--   ALTER TABLE export_jobs DROP COLUMN attempts;
--   ALTER TABLE report_runs DROP COLUMN attempts;
--   ALTER TABLE hod_report_runs DROP COLUMN attempts;

ALTER TABLE export_jobs
  ADD COLUMN attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'claims so far; the export gives up after 3' AFTER status;

ALTER TABLE report_runs
  ADD COLUMN attempts TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '2 = the one retry after a crash' AFTER status;

ALTER TABLE hod_report_runs
  ADD COLUMN attempts TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '2 = the one retry after a crash' AFTER status;
