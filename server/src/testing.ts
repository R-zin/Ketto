import { randomBytes } from "node:crypto";
import { Store, id } from "./db.js";
import { passwordHash, passwordMatches } from "./security.js";

export type TestAccount = {
  id: string;
  name: string;
  email: string;
  password: string | null;
  number?: number;
};

/** Prepare numbered accounts without resetting unrelated or existing credentials. */
export function prepareTestAccounts(
  db: Store,
  count: number,
  saved: TestAccount[],
): TestAccount[] {
  if (!Number.isInteger(count) || count < 1 || count > 50)
    throw new Error("Test account count must be between 1 and 50.");
  const accounts: TestAccount[] = [];
  for (let n = 1; n <= count; n++) {
    const email = `vol${n}@kettoo.local`;
    const old = saved.find(
      (a) => a.number === n || (!a.number && a.email === email),
    );
    const current =
      old &&
      db.get(
        "SELECT id,name,email,role,password FROM users WHERE id=?",
        old.id,
      );
    if (current) {
      if (current.role !== "staff")
        throw new Error(
          "Test account identity changed; no accounts were updated.",
        );
      accounts.push({
        id: current.id,
        name: current.name,
        email: current.email,
        number: n,
        // Admin-set passwords cannot be recovered. Never print stale credentials.
        password:
          old.password && passwordMatches(old.password, current.password)
            ? old.password
            : null,
      });
      continue;
    }
    const existing = db.get("SELECT id,role FROM users WHERE email=?", email);
    if (
      existing &&
      (!old || old.id !== existing.id || existing.role !== "staff")
    )
      throw new Error(
        `${email} already exists outside this helper. Its account and password were left unchanged.`,
      );
    accounts.push(
      old
        ? { ...old, number: n }
        : {
            id: id(),
            number: n,
            name: `Vol ${n}`,
            email,
            password: `Vol${n}-${randomBytes(9).toString("base64url")}!`,
          },
    );
  }
  return accounts;
}

export function saveTestAccounts(
  db: Store,
  accounts: TestAccount[],
  approveDevices = false,
) {
  db.transaction(() => {
    for (const account of accounts) {
      const existing = db.get(
        "SELECT id,role FROM users WHERE id=? OR email=? COLLATE NOCASE",
        account.id,
        account.email,
      );
      if (existing && (existing.id !== account.id || existing.role !== "staff"))
        throw new Error(
          "Test account identity changed; no accounts were updated.",
        );
      if (!existing) {
        if (!account.password)
          throw new Error("A password is required to create a test account.");
        db.run(
          "INSERT INTO users VALUES(?,?,?,?, 'staff',1)",
          account.id,
          account.name,
          account.email,
          passwordHash(account.password),
        );
        db.run(
          "INSERT OR IGNORE INTO members VALUES(?,?)",
          "all-staff",
          account.id,
        );
        db.audit(account.id, "create-test-user", account.id);
      }
      if (approveDevices) {
        for (const device of db.all(
          "SELECT id FROM devices WHERE user_id=? AND approved=0",
          account.id,
        )) {
          db.run("UPDATE devices SET approved=1 WHERE id=?", device.id);
          db.audit(account.id, "approve-device", device.id);
        }
      }
    }
  });
}
