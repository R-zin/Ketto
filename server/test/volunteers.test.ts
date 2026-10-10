import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { buildApp } from "../src/app.js";
import { passwordMatches } from "../src/security.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "kettoo-volunteers-"));
  const removed: string[] = [],
    publishing: boolean[] = [],
    sockets: any[] = [];
  let blockRemoval: (() => Promise<void>) | undefined;
  const app = await buildApp({
    dataDir: directory,
    adminPassword: "volunteers-admin-password",
    media: {
      configured: true,
      url: "wss://invalid.test",
      token: async () => "test-token",
      publishing: async (_room, _device, allowed) => {
        publishing.push(allowed);
      },
      remove: async (_room, device) => {
        removed.push(device);
        await blockRemoval?.();
      },
      close: async () => {},
    },
  });
  await app.ready();
  const db = new DatabaseSync(join(directory, "kettoo.sqlite"));
  const req = (method: any, url: string, body?: any, user?: any) =>
    app.inject({
      method,
      url,
      payload: body,
      headers: user ? { authorization: "Bearer " + user.token } : {},
    });
  const admin = (
    await req("POST", "/api/login", {
      email: "admin@kettoo.local",
      password: "volunteers-admin-password",
    })
  ).json();
  async function volunteer(name = "Test volunteer") {
    const created = await req(
      "POST",
      "/api/admin/volunteers",
      {
        name,
        email: `${name.replaceAll(" ", "")}@test.invalid`,
        password: "volunteer-test-password",
      },
      admin,
    );
    assert.equal(created.statusCode, 200, created.body);
    const u = created.json();
    const pending = (
      await req("POST", "/api/login", {
        email: u.email,
        password: "volunteer-test-password",
      })
    ).json();
    assert.equal(pending.pending, true);
    await req(
      "POST",
      `/api/admin/devices/${pending.deviceId}/approval`,
      { approved: true },
      admin,
    );
    const login = (
      await req("POST", "/api/login", {
        email: u.email,
        password: "volunteer-test-password",
        deviceId: pending.deviceId,
      })
    ).json();
    assert.ok(login.token);
    return { ...login, email: u.email };
  }
  return {
    app,
    db,
    req,
    admin,
    volunteer,
    removed,
    publishing,
    sockets,
    blockRemoval: (fn: () => Promise<void>) => {
      blockRemoval = fn;
    },
    cleanup: async () => {
      sockets.forEach((s) => s.close());
      db.close();
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("only admins can create approved volunteers, with validated unique emails and hashed passwords", async () => {
  const f = await fixture();
  try {
    const body = {
      name: "New volunteer",
      email: " New.Volunteer@Test.Invalid ",
      password: "new-volunteer-password",
    };
    assert.equal(
      (await f.req("POST", "/api/admin/volunteers", body)).statusCode,
      401,
    );
    const staff = await f.volunteer();
    assert.equal(
      (await f.req("POST", "/api/admin/volunteers", body, staff)).statusCode,
      403,
    );
    for (const invalid of [
      { ...body, password: "short" },
      { ...body, name: " " },
      { ...body, email: "invalid" },
      { ...body, role: "admin" },
    ])
      assert.equal(
        (await f.req("POST", "/api/admin/volunteers", invalid, f.admin))
          .statusCode,
        400,
      );
    const result = await f.req("POST", "/api/admin/volunteers", body, f.admin);
    assert.equal(result.statusCode, 200, result.body);
    const u = result.json();
    assert.equal(u.email, "new.volunteer@test.invalid");
    assert.equal(u.role, "staff");
    assert.equal(u.approved, 1);
    assert.equal(u.password, undefined);
    const stored: any = f.db
      .prepare("SELECT * FROM users WHERE id=?")
      .get(u.id);
    assert.notEqual(stored.password, body.password);
    assert.ok(passwordMatches(body.password, stored.password));
    assert.ok(
      f.db
        .prepare(
          "SELECT 1 FROM members WHERE user_id=? AND conversation_id='all-staff'",
        )
        .get(u.id),
    );
    assert.equal(
      (await f.req("POST", "/api/admin/volunteers", body, f.admin)).statusCode,
      409,
    );
    const pending = (
      await f.req("POST", "/api/login", {
        email: u.email,
        password: body.password,
      })
    ).json();
    assert.equal(pending.pending, true);
    assert.equal(pending.token, undefined);
    assert.ok(
      f.db
        .prepare(
          "SELECT 1 FROM audit WHERE actor=? AND action='create-volunteer' AND target=?",
        )
        .get(f.admin.user.id, u.id),
    );
  } finally {
    await f.cleanup();
  }
});

test("email edits preserve volunteer identity, memberships, history and approval; other accounts remain protected", async () => {
  const f = await fixture();
  try {
    const staff = await f.volunteer();
    const uid = staff.user.id,
      path = `/api/admin/volunteers/${uid}`;
    const channel = (
      await f.req(
        "POST",
        "/api/admin/channels",
        { name: "Volunteer work" },
        f.admin,
      )
    ).json().id;
    await f.req(
      "PUT",
      `/api/admin/channels/${channel}/members`,
      { memberIds: [uid, f.admin.user.id] },
      f.admin,
    );
    const mid = randomUUID();
    assert.equal(
      (
        await f.req(
          "POST",
          `/api/conversations/${channel}/messages`,
          { id: mid, text: "Keep this history", createdAt: Date.now() },
          staff,
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await f.req("PUT", path, { email: "new@test.invalid" })).statusCode,
      401,
    );
    assert.equal(
      (await f.req("PUT", path, { email: "new@test.invalid" }, staff))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await f.req(
          "PUT",
          `/api/admin/volunteers/${f.admin.user.id}`,
          { password: "changed-admin-password" },
          f.admin,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.req(
          "PUT",
          path,
          { email: "ADMIN@kettoo.local", password: "changed-test-password" },
          f.admin,
        )
      ).statusCode,
      409,
    );
    for (const invalid of [
      {},
      { password: "" },
      { email: "invalid" },
      { email: "new@test.invalid", approved: true },
    ])
      assert.equal(
        (await f.req("PUT", path, invalid, f.admin)).statusCode,
        400,
      );
    assert.equal(
      (
        await f.req(
          "PUT",
          "/api/admin/volunteers/missing",
          { email: "new@test.invalid" },
          f.admin,
        )
      ).statusCode,
      404,
    );
    const changed = await f.req(
      "PUT",
      path,
      { email: " Changed@Test.Invalid " },
      f.admin,
    );
    assert.equal(changed.statusCode, 200, changed.body);
    assert.equal(changed.json().id, uid);
    assert.equal(changed.json().passwordChanged, false);
    assert.equal(
      (await f.req("GET", "/api/me", undefined, staff)).statusCode,
      200,
    );
    assert.equal(
      (
        await f.req("POST", "/api/login", {
          email: staff.email,
          password: "volunteer-test-password",
          deviceId: staff.deviceId,
        })
      ).statusCode,
      401,
    );
    assert.ok(
      (
        await f.req("POST", "/api/login", {
          email: "changed@test.invalid",
          password: "volunteer-test-password",
          deviceId: staff.deviceId,
        })
      ).json().token,
    );
    assert.ok(
      f.db
        .prepare("SELECT 1 FROM members WHERE user_id=? AND conversation_id=?")
        .get(uid, channel),
    );
    assert.ok(
      f.db
        .prepare("SELECT 1 FROM messages WHERE id=? AND sender_id=?")
        .get(mid, uid),
    );
    await f.req(
      "POST",
      `/api/admin/users/${uid}/approval`,
      { approved: false },
      f.admin,
    );
    await f.req(
      "PUT",
      path,
      { password: "pending-volunteer-password" },
      f.admin,
    );
    assert.equal(
      (f.db.prepare("SELECT approved FROM users WHERE id=?").get(uid) as any)
        .approved,
      0,
    );
    assert.equal(
      (
        await f.req("POST", "/api/login", {
          email: "changed@test.invalid",
          password: "pending-volunteer-password",
          deviceId: staff.deviceId,
        })
      ).statusCode,
      403,
    );
  } finally {
    await f.cleanup();
  }
});

test("password reset revokes all sessions, pending websocket tickets and live transmission without racing a new login", async () => {
  const f = await fixture();
  try {
    const staff = await f.volunteer();
    const channel = (
      await f.req("POST", "/api/admin/channels", { name: "Radio" }, f.admin)
    ).json().id;
    await f.req(
      "PUT",
      `/api/admin/channels/${channel}/members`,
      { memberIds: [staff.user.id, f.admin.user.id] },
      f.admin,
    );
    const second = (
      await f.req("POST", "/api/login", {
        email: staff.email,
        password: "volunteer-test-password",
      })
    ).json();
    await f.req(
      "POST",
      `/api/admin/devices/${second.deviceId}/approval`,
      { approved: true },
      f.admin,
    );
    const secondSession = (
      await f.req("POST", "/api/login", {
        email: staff.email,
        password: "volunteer-test-password",
        deviceId: second.deviceId,
      })
    ).json();
    const ticket = (await f.req("POST", "/api/ws-ticket", {}, staff)).json()
      .ticket;
    const socket = await f.app.injectWS("/api/events?ticket=" + ticket);
    f.sockets.push(socket);
    socket.send(
      JSON.stringify({ type: "heartbeat", onDuty: true, rooms: [channel] }),
    );
    await new Promise((r) => setTimeout(r, 20));
    const lease = await f.req(
      "POST",
      `/api/conversations/${channel}/ptt`,
      {},
      staff,
    );
    assert.equal(lease.statusCode, 200, lease.body);
    const pendingTicket = (
      await f.req("POST", "/api/ws-ticket", {}, secondSession)
    ).json().ticket;
    const socketClosed = once(socket, "close");
    let unblock!: () => void, started!: () => void;
    const blocked = new Promise<void>((r) => {
      unblock = r;
    });
    const removalStarted = new Promise<void>((r) => {
      started = r;
    });
    f.blockRemoval(async () => {
      started();
      await blocked;
    });
    const reset = f.req(
      "PUT",
      `/api/admin/volunteers/${staff.user.id}`,
      { password: "replacement-test-password" },
      f.admin,
    );
    // Start injection now, then attempt login while media cleanup is waiting.
    const resetResult = Promise.resolve(reset);
    await removalStarted;
    let signedIn = false;
    const login = Promise.resolve(
      f.req("POST", "/api/login", {
        email: staff.email,
        password: "replacement-test-password",
        deviceId: staff.deviceId,
      }),
    ).then((r) => {
      signedIn = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(signedIn, false);
    assert.equal(
      (await f.req("GET", "/api/me", undefined, staff)).statusCode,
      401,
    );
    assert.equal(
      (await f.req("GET", "/api/me", undefined, secondSession)).statusCode,
      401,
    );
    unblock();
    const result = await resetResult;
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().passwordChanged, true);
    assert.equal((await socketClosed)[0], 4001);
    assert.equal(f.publishing.at(-1), false);
    assert.ok(f.removed.includes(staff.deviceId));
    assert.ok(f.removed.includes(second.deviceId));
    const stale = await f.app.injectWS("/api/events?ticket=" + pendingTicket);
    f.sockets.push(stale);
    assert.equal((await once(stale, "close"))[0], 4001);
    assert.equal(
      (
        await f.req("POST", "/api/login", {
          email: staff.email,
          password: "volunteer-test-password",
          deviceId: staff.deviceId,
        })
      ).statusCode,
      401,
    );
    const fresh = (await login).json();
    assert.ok(fresh.token);
    assert.equal(
      (await f.req("GET", "/api/me", undefined, fresh)).statusCode,
      200,
    );
    assert.equal(
      (
        f.db
          .prepare("SELECT approved FROM devices WHERE id=?")
          .get(staff.deviceId) as any
      ).approved,
      1,
    );
    assert.equal(
      (
        f.db
          .prepare("SELECT status FROM messages WHERE id=?")
          .get(lease.json().message) as any
      ).status,
      "interrupted",
    );
  } finally {
    await f.cleanup();
  }
});
