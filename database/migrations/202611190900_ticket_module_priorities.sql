-- v1.55.1 (owner, 18 Nov 2026):
-- (1) "i want the ticketing as a separate module": TICKET joins users.module_access
--     (given per person in Users & roles, like Meeting Management; nobody has it until IT ticks it).
-- (2) "wherever Priority is involved it should be Critical, Most Important,
--     Important, High, Normal": one scale everywhere. Stored values keep their
--     meaning: URGENT = Critical, HIGH = Most Important, IMPORTANT = Important,
--     ELEVATED = High (new), NORMAL = Normal. Old ticket values move: HIGH
--     ("High") → ELEVATED, MEDIUM and LOW → NORMAL.
--
-- Rollback (after rolling the code back):
--   UPDATE users SET module_access = TRIM(BOTH ',' FROM REPLACE(CONCAT(',', module_access, ','), ',TICKET,', ',')) WHERE FIND_IN_SET('TICKET', module_access);
--   ALTER TABLE users MODIFY module_access SET('APPROVAL', 'TASK', 'PROJECT', 'INFORMATION', 'AI', 'MEETING') NOT NULL DEFAULT 'APPROVAL,TASK';
--   UPDATE tasks SET priority = 'IMPORTANT' WHERE priority = 'ELEVATED';  (and the same for info_items, meetings, meeting_actions)
--   then each table's MODIFY priority back to its earlier list (see the earlier migrations).

ALTER TABLE users
  MODIFY module_access SET('APPROVAL', 'TASK', 'PROJECT', 'INFORMATION', 'AI', 'MEETING', 'TICKET') NOT NULL DEFAULT 'APPROVAL,TASK';

ALTER TABLE tasks MODIFY priority ENUM('LOW', 'NORMAL', 'ELEVATED', 'IMPORTANT', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL';
ALTER TABLE info_items MODIFY priority ENUM('NORMAL', 'ELEVATED', 'IMPORTANT', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL';
ALTER TABLE meetings MODIFY priority ENUM('NORMAL', 'ELEVATED', 'IMPORTANT', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL';
ALTER TABLE meeting_actions MODIFY priority ENUM('NORMAL', 'ELEVATED', 'IMPORTANT', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL';

-- Tickets: widen, move the old values, then keep only the five.
ALTER TABLE tickets MODIFY priority ENUM('HIGH', 'MEDIUM', 'LOW', 'URGENT', 'IMPORTANT', 'ELEVATED', 'NORMAL') NOT NULL DEFAULT 'NORMAL';
UPDATE tickets SET priority = CASE priority WHEN 'HIGH' THEN 'ELEVATED' WHEN 'MEDIUM' THEN 'NORMAL' WHEN 'LOW' THEN 'NORMAL' ELSE priority END
  WHERE priority IN ('HIGH', 'MEDIUM', 'LOW');
ALTER TABLE tickets MODIFY priority ENUM('URGENT', 'HIGH', 'IMPORTANT', 'ELEVATED', 'NORMAL') NOT NULL DEFAULT 'NORMAL';

-- Ticket forms' default priority (kept in each version's settings).
UPDATE module_type_versions v
  JOIN module_types t ON t.id = v.type_id AND t.module = 'TICKET'
  SET v.settings_json = JSON_SET(v.settings_json, '$.defaultPriority',
    CASE JSON_UNQUOTE(JSON_EXTRACT(v.settings_json, '$.defaultPriority')) WHEN 'HIGH' THEN 'ELEVATED' WHEN 'MEDIUM' THEN 'NORMAL' WHEN 'LOW' THEN 'NORMAL' ELSE JSON_UNQUOTE(JSON_EXTRACT(v.settings_json, '$.defaultPriority')) END)
  WHERE JSON_EXTRACT(v.settings_json, '$.defaultPriority') IS NOT NULL;
