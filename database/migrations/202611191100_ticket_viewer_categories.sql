-- v1.57.1 (D-338, owner, 18 Nov 2026: "if i have coordinator rights for admin
-- ticket then only the coordinators should see the admin ticketing in the
-- dashboard and Coordinator page"): the people named in Admin → Ticket
-- categories → Who else sees tickets can be limited to some categories (e.g. the
-- IT department sees IT Software and IT Hardware, not Admin). category_id NULL
-- means every category (as in v1.57.0). Run after 202611191000.
--
-- Rollback (after rolling the code back):
--   DELETE FROM ticket_viewers WHERE category_id IS NOT NULL;
--   ALTER TABLE ticket_viewers DROP FOREIGN KEY fk_ticket_viewers_category, DROP INDEX uq_ticket_viewers_department_category, DROP INDEX uq_ticket_viewers_user_category, DROP COLUMN category_id,
--     ADD UNIQUE KEY uq_ticket_viewers_department (department_id), ADD UNIQUE KEY uq_ticket_viewers_user (user_id);

ALTER TABLE ticket_viewers
  ADD COLUMN category_id BIGINT UNSIGNED NULL COMMENT 'NULL = every category' AFTER user_id,
  ADD CONSTRAINT fk_ticket_viewers_category FOREIGN KEY (category_id) REFERENCES ticket_categories (id);

-- One row per (department or person, category); the old one-row-each keys go.
ALTER TABLE ticket_viewers
  ADD UNIQUE KEY uq_ticket_viewers_department_category (department_id, category_id),
  ADD UNIQUE KEY uq_ticket_viewers_user_category (user_id, category_id);
ALTER TABLE ticket_viewers
  DROP INDEX uq_ticket_viewers_department,
  DROP INDEX uq_ticket_viewers_user;
