-- v1.59.3 (D-362, owner, 20 Nov 2026: "For Ticket assignment i dont want task
-- to be created instead i want an option to update the task status in the
-- ticket itself"; for tickets already assigned: "Cancel open ones, continue in
-- ticket"). New assignments no longer make a task. This cancels the tasks
-- still open (Open, In progress, Blocked) that belong to a ticket, with a note
-- in each task's history; completed and cancelled ones stay as they are. The
-- tickets keep their status and assignee, and their task_id (the task stays
-- reachable from the ticket as history). Data only, no schema change. Safe to
-- run twice (the second run finds nothing open). Run after 202611191200.
--
-- Rollback (after rolling the code back): the tasks can be reopened by hand from
-- their pages; or, for the tasks this cancelled:
--   UPDATE tasks t JOIN task_events e ON e.task_id = t.id AND e.event_type = 'CANCEL'
--     AND JSON_EXTRACT(e.payload_json, '$.retiredBy') = 'v1.59.3'
--   SET t.status = e.from_status, t.cancelled_by = NULL, t.cancelled_at = NULL, t.row_version = t.row_version + 1;

INSERT INTO task_events (task_id, actor_id, event_type, from_status, to_status, body, payload_json)
SELECT t.id, NULL, 'CANCEL', t.status, 'CANCELLED',
       CONCAT('Ticket ', k.ticket_no, ' is now updated on the ticket itself.'),
       JSON_OBJECT('ticketId', k.id, 'ticketNo', k.ticket_no, 'retiredBy', 'v1.59.3')
FROM tickets k
JOIN tasks t ON t.id = k.task_id
WHERE t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED');

UPDATE tasks t
JOIN tickets k ON k.task_id = t.id
SET t.status = 'CANCELLED', t.cancelled_at = UTC_TIMESTAMP(), t.row_version = t.row_version + 1
WHERE t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED');
