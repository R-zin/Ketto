import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/db.js";
import { prepareTestAccounts, saveTestAccounts } from "../src/testing.js";
import { passwordHash, passwordMatches } from "../src/security.js";

test("test-account helper is repeatable, preserves passwords and approves only requested test devices", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kettoo-test-users-"));
  const db = new Store(join(directory, "kettoo.sqlite"));
  try {
    db.run(
      "INSERT INTO users VALUES('other','Other','other@test.invalid',?,'staff',0)",
      passwordHash("other-test-password"),
    );
    db.run(
      "INSERT INTO devices(id,user_id,name,approved) VALUES('other-device','other','Other phone',0)",
    );
    const accounts = prepareTestAccounts(db, 3, []);
    saveTestAccounts(db, accounts);
    assert.equal(db.get("SELECT COUNT(*) n FROM users").n, 4);
    for (const account of accounts) {
      const u = db.get("SELECT * FROM users WHERE id=?", account.id);
      assert.equal(u.role, "staff");
      assert.equal(u.approved, 1);
      assert.ok(passwordMatches(account.password, u.password));
      assert.ok(
        db.get(
          "SELECT 1 FROM members WHERE user_id=? AND conversation_id='all-staff'",
          account.id,
        ),
      );
    }
    db.run(
      "INSERT INTO devices(id,user_id,name,approved) VALUES('test-device',?,'Test phone',0)",
      accounts[0].id,
    );
    const hashes = db.all("SELECT password FROM users ORDER BY id");
    const repeated = prepareTestAccounts(db, 3, accounts);
    assert.deepEqual(repeated, accounts);
    saveTestAccounts(db, repeated);
    assert.deepEqual(db.all("SELECT password FROM users ORDER BY id"), hashes);
    assert.equal(
      db.get("SELECT approved FROM devices WHERE id='test-device'").approved,
      0,
    );
    saveTestAccounts(db, repeated, true);
    assert.equal(
      db.get("SELECT approved FROM devices WHERE id='test-device'").approved,
      1,
    );
    assert.equal(
      db.get("SELECT approved FROM devices WHERE id='other-device'").approved,
      0,
    );
    assert.equal(
      db.get("SELECT approved FROM users WHERE id='other'").approved,
      0,
    );
    assert.throws(() => prepareTestAccounts(db, 3, []), /outside this helper/);
    assert.throws(
      () => prepareTestAccounts(db, 51, accounts),
      /between 1 and 50/,
    );
    const more = prepareTestAccounts(db, 4, accounts);
    saveTestAccounts(db, more);
    assert.equal(db.get("SELECT COUNT(*) n FROM users").n, 5);
  } finally {
    db.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
