import recreateTestDatabase from "../integration/global-setup";
import { db } from "./db";
import { startMockProvider } from "./mock-provider";

// Fresh test database with the real migrations and seeds, then the people
// the scenarios need:
//   E2E_ADMIN (IT Admin), E2E_SUPER (Super Admin), E2E_REQ (requester), E2E_MGR (requester's manager),
//   E2E_HOD (HOD of the requester's department), E2E_STAFF (plain user).
export default async function globalSetup(): Promise<void> {
  await recreateTestDatabase();
  // D-172: the mock AI provider stays up for the whole run (closed with the runner).
  await startMockProvider().catch(() => undefined);
  const conn = await db();
  try {
    // D-085: managers and above approve; the requester and staff don't.
    const [manager_] = await conn.query<import("mysql2/promise").ResultSetHeader>("INSERT INTO designations (code, name, is_approver) VALUES ('E2E_MANAGER', 'Manager', TRUE)");
    const [executive] = await conn.query<import("mysql2/promise").ResultSetHeader>("INSERT INTO designations (code, name, is_approver) VALUES ('E2E_EXEC', 'Executive', FALSE)");
    const add = async (loginId: string, name: string, roles: string[], managerId: number | null = null, departmentId: number | null = null, approver = true) => {
      const [result] = await conn.query<import("mysql2/promise").ResultSetHeader>(
        // D-307: new people start with Approvals and Tasks only; the scenarios use every released-or-not module but AI.
        "INSERT INTO users (login_id, name, email, sign_in_method, reporting_manager_id, department_id, designation_id, active, last_login_at, module_access) VALUES (?, ?, ?, 'GOOGLE', ?, ?, ?, TRUE, CURRENT_TIMESTAMP, 'APPROVAL,TASK,PROJECT,INFORMATION,MEETING')",
        [loginId, name, `${loginId.toLowerCase()}@example.test`, managerId, departmentId, approver ? manager_.insertId : executive.insertId],
      );
      await conn.query("INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code IN (?)", [result.insertId, roles]);
      return result.insertId;
    };
    await add("E2E_ADMIN", "Elena Admin", ["USER", "IT_ADMIN"]);
    await add("E2E_SUPER", "Sam Super", ["USER", "IT_ADMIN", "SUPER_ADMIN"]);
    const hod = await add("E2E_HOD", "Harini HOD", ["USER"]);
    const [dept] = await conn.query<import("mysql2/promise").ResultSetHeader>("INSERT INTO departments (code, name, hod_user_id) VALUES ('E2E', 'E2E Department', ?)", [hod]);
    const manager = await add("E2E_MGR", "Manoj Manager", ["USER"], null, dept.insertId);
    await add("E2E_REQ", "Ravi Requester", ["USER"], manager, dept.insertId, false);
    await add("E2E_STAFF", "Sita Staff", ["USER"], null, null, false);
    // v1.61.0 (D-367): the PM phase A switch is OFF in production until IT releases it; ON for the e2e run.
    await conn.query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('features.pm_foundations', 'FEATURES', 'STRING', FALSE, 'ON') ON DUPLICATE KEY UPDATE value = 'ON'");
    // v1.64.0 (D-371): the PM phase B switch (custom fields), likewise ON for the e2e run.
    await conn.query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('features.pm_planning', 'FEATURES', 'STRING', FALSE, 'ON') ON DUPLICATE KEY UPDATE value = 'ON'");
    // v1.66.0 (D-374): the PM phase C switch (project intake forms), likewise ON for the e2e run.
    await conn.query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('features.pm_forms', 'FEATURES', 'STRING', FALSE, 'ON') ON DUPLICATE KEY UPDATE value = 'ON'");
    await conn.query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('features.pm_reporting', 'FEATURES', 'STRING', FALSE, 'ON') ON DUPLICATE KEY UPDATE value = 'ON'");
    // v1.68.0 (D-380): the PM automations switch, likewise ON for the e2e run.
    await conn.query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('features.pm_automations', 'FEATURES', 'STRING', FALSE, 'ON') ON DUPLICATE KEY UPDATE value = 'ON'");
    // v1.69.0 (D-382): the PM portfolios switch, likewise ON for the e2e run.
    await conn.query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('features.pm_portfolios', 'FEATURES', 'STRING', FALSE, 'ON') ON DUPLICATE KEY UPDATE value = 'ON'");
  } finally {
    await conn.end();
  }
}
