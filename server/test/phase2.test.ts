import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/db.js";
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "kettoo-phase2-")),
    closed: string[] = [];
  const app = await buildApp({
    dataDir: directory,
    adminPassword: "phase2-admin-password",
    media: {
      configured: true,
      url: "wss://invalid.test",
      token: async (room) => room,
      publishing: async () => {},
      remove: async () => {},
      close: async (room) => {
        closed.push(room);
      },
    },
  });
  await app.ready();
  const req = async (method: any, url: string, body?: any, u?: any) =>
    app.inject({
      method,
      url,
      payload: body,
      headers: u ? { authorization: "Bearer " + u.token } : {},
    });
  const admin = (
    await req("POST", "/api/login", {
      email: "admin@kettoo.local",
      password: "phase2-admin-password",
    })
  ).json();
  async function member(name: string) {
    const r = (
      await req("POST", "/api/register", {
        name,
        email: name + "@test.invalid",
        password: "phase2-staff-password",
        deviceName: name,
      })
    ).json();
    await req(
      "POST",
      `/api/admin/users/${r.userId}/approval`,
      { approved: true },
      admin,
    );
    await req(
      "POST",
      `/api/admin/devices/${r.deviceId}/approval`,
      { approved: true },
      admin,
    );
    return (
      await req("POST", "/api/login", {
        email: name + "@test.invalid",
        password: "phase2-staff-password",
        deviceId: r.deviceId,
      })
    ).json();
  }
  const alice = await member("Alice"),
    bob = await member("Bob"),
    carol = await member("Carol");
  const stage = (
      await req(
        "POST",
        "/api/admin/operational-teams",
        { name: "Stage" },
        admin,
      )
    ).json(),
    security = (
      await req(
        "POST",
        "/api/admin/operational-teams",
        { name: "Security" },
        admin,
      )
    ).json();
  for (const [u, t] of [
    [alice, stage],
    [bob, stage],
    [carol, security],
  ])
    assert.equal(
      (
        await req(
          "PUT",
          "/api/admin/operational-assignments/" + u.user.id,
          { teamId: t.id },
          admin,
        )
      ).statusCode,
      200,
    );
  const floor = (
      await req("POST", "/api/admin/floors", { name: "Ground floor" }, admin)
    ).json(),
    zone = (
      await req(
        "POST",
        "/api/admin/zones",
        { floorId: floor.id, name: "Stage", x: 0.3, y: 0.6 },
        admin,
      )
    ).json();
  const sockets: any[] = [];
  async function connect(u: any, rooms: string[]) {
    const t = (await req("POST", "/api/ws-ticket", {}, u)).json().ticket,
      ws = await app.injectWS("/api/events?ticket=" + t);
    ws.send(JSON.stringify({ type: "heartbeat", onDuty: true, rooms }));
    sockets.push(ws);
    await new Promise((r) => setTimeout(r, 25));
    return ws;
  }
  const create = async (u = alice, audience = "team") => {
    const id = randomUUID(),
      r = await req(
        "POST",
        "/api/threads",
        {
          id,
          title: "Entrance blocked",
          description: "Clear the equipment",
          priority: "high",
          audience,
          teamId: stage.id,
          zoneId: zone.id,
          createdAt: Date.now(),
        },
        u,
      );
    assert.equal(r.statusCode, 200, r.body);
    return id;
  };
  return {
    directory,
    closeSockets: () => sockets.forEach((s) => s.close()),
    app,
    req,
    admin,
    alice,
    bob,
    carol,
    stage,
    security,
    floor,
    zone,
    closed,
    connect,
    create,
    cleanup: async () => {
      sockets.forEach((s) => s.close());
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
test("channel renaming keeps memberships and history and updates broadcast labels", async () => {
  const f = await fixture();
  try {
    const { req, admin, alice, stage, security } = f;
    const iid = await f.create();
    const mid = randomUUID();
    assert.equal(
      (
        await req(
          "POST",
          `/api/conversations/${stage.channelId}/messages`,
          {
            id: mid,
            kind: "text",
            text: "Keep this message",
            createdAt: Date.now(),
          },
          alice,
        )
      ).statusCode,
      200,
    );
    const broadcast = (
      await req(
        "POST",
        "/api/admin/broadcasts",
        { teamIds: [stage.id, security.id] },
        admin,
      )
    ).json();
    const path = `/api/admin/channels/${stage.channelId}`;
    assert.equal(
      (await req("PUT", path, { name: "Main hall" }, alice)).statusCode,
      403,
    );
    assert.equal(
      (await req("PUT", path, { name: "Security" }, admin)).statusCode,
      409,
    );
    assert.equal(
      (await req("PUT", path, { name: " " }, admin)).statusCode,
      400,
    );
    const renamed = await req("PUT", path, { name: " Main hall " }, admin);
    assert.equal(renamed.statusCode, 200, renamed.body);
    const channels = (
      await req("GET", "/api/conversations", undefined, admin)
    ).json();
    assert.equal(
      channels.find((c: any) => c.id === stage.channelId).name,
      "Main hall",
    );
    assert.match(
      channels.find((c: any) => c.id === broadcast.id).name,
      /Main hall/,
    );
    assert.match(
      channels.find((c: any) => c.id === broadcast.id).name,
      /Security/,
    );
    const ops = (await req("GET", "/api/operations", undefined, alice)).json();
    assert.equal(
      ops.channelMemberships.find((t: any) => t.id === stage.id).name,
      "Main hall",
    );
    assert.ok(
      (
        await req(
          "GET",
          `/api/conversations/${stage.channelId}/messages`,
          undefined,
          alice,
        )
      )
        .json()
        .messages.some((m: any) => m.id === mid),
    );
    assert.equal(
      (await req("GET", `/api/threads/${iid}`, undefined, alice)).statusCode,
      200,
    );
    assert.equal(
      (
        await req(
          "PUT",
          "/api/admin/channels/all-staff",
          { name: "Oops" },
          admin,
        )
      ).statusCode,
      404,
    );
    await req("DELETE", path, undefined, admin);
    assert.equal(
      (await req("PUT", path, { name: "Archived rename" }, admin)).statusCode,
      409,
    );
  } finally {
    await f.cleanup();
  }
});

test("map people counts include admins and count multiple devices only once", async () => {
  const f = await fixture();
  try {
    const { req, admin, alice, bob, zone } = f;
    for (const u of [admin, alice, bob])
      await req(
        "POST",
        "/api/checkins",
        { id: randomUUID(), zoneId: zone.id, reportedAt: Date.now() },
        u,
      );
    const second = await req("POST", "/api/login", {
      email: "admin@kettoo.local",
      password: "phase2-admin-password",
      deviceName: "Second test device",
    });
    const deviceId = second.json().deviceId;
    await req(
      "POST",
      `/api/admin/devices/${deviceId}/approval`,
      { approved: true },
      admin,
    );
    const secondAdmin = (
      await req("POST", "/api/login", {
        email: "admin@kettoo.local",
        password: "phase2-admin-password",
        deviceId,
      })
    ).json();
    await f.connect(admin, []);
    await f.connect(secondAdmin, []);
    await f.connect(alice, []);
    const ops = (await req("GET", "/api/operations", undefined, admin)).json();
    const counted = ops.zones.find((z: any) => z.id === zone.id);
    assert.equal(counted.reportedPeople, 3);
    assert.equal(counted.onDutyPeople, 2);
    assert.equal(counted.volunteers, 1);
    assert.ok(ops.people.some((p: any) => p.id === admin.user.id));
    assert.ok(!ops.volunteers.some((p: any) => p.id === admin.user.id));
    const staffOps = (
      await req("GET", "/api/operations", undefined, alice)
    ).json();
    assert.deepEqual(staffOps.people, []);
  } finally {
    await f.cleanup();
  }
});

test("zone removal clears only its locations and preserves floors and issue history", async () => {
  const f = await fixture();
  try {
    const { req, admin, alice, bob, floor, zone } = f;
    const iid = await f.create();
    const rid = randomUUID();
    await req(
      "POST",
      `/api/threads/${iid}/replies`,
      { id: rid, text: "Keep follow-up", createdAt: Date.now() },
      alice,
    );
    const other = (
      await req(
        "POST",
        "/api/admin/zones",
        { floorId: floor.id, name: "Canteen", x: 0.7, y: 0.4 },
        admin,
      )
    ).json();
    for (const [u, z] of [
      [alice, zone],
      [bob, other],
    ]) {
      assert.equal(
        (
          await req(
            "POST",
            "/api/checkins",
            { id: randomUUID(), zoneId: z.id, reportedAt: Date.now() },
            u,
          )
        ).statusCode,
        200,
      );
    }
    const path = `/api/admin/zones/${zone.id}`;
    assert.equal((await req("DELETE", path, undefined, alice)).statusCode, 403);
    assert.deepEqual((await req("DELETE", path, undefined, admin)).json(), {
      ok: true,
      clearedCheckins: 1,
    });
    const ops = (await req("GET", "/api/operations", undefined, admin)).json();
    assert.ok(ops.floors.some((x: any) => x.id === floor.id));
    assert.ok(ops.zones.some((x: any) => x.id === other.id));
    assert.ok(!ops.zones.some((x: any) => x.id === zone.id));
    assert.equal(
      (await req("GET", "/api/operations", undefined, alice)).json().checkin,
      null,
    );
    assert.equal(
      (await req("GET", "/api/operations", undefined, bob)).json().checkin
        .zone_id,
      other.id,
    );
    const retained = (
      await req("GET", `/api/threads/${iid}`, undefined, alice)
    ).json();
    assert.equal(retained.zone_id, null);
    assert.ok(retained.replies.some((r: any) => r.id === rid));
    assert.equal((await req("DELETE", path, undefined, admin)).statusCode, 404);
    assert.equal(
      (await req("PUT", path, { name: "Gone", x: 0.3, y: 0.4 }, admin))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await req(
          "POST",
          "/api/checkins",
          { id: randomUUID(), zoneId: zone.id, reportedAt: Date.now() },
          alice,
        )
      ).statusCode,
      400,
    );
  } finally {
    await f.cleanup();
  }
});

test("deleted channels stop active use, preserve history and restore multiple memberships", async () => {
  const f = await fixture();
  try {
    const { req, admin, alice, stage, security } = f;
    await req(
      "PUT",
      `/api/admin/operational-assignments/${alice.user.id}`,
      { teamId: security.id, assigned: true },
      admin,
    );
    const issueId = await f.create();
    const messageId = randomUUID();
    const sent = await req(
      "POST",
      `/api/conversations/${stage.channelId}/messages`,
      {
        id: messageId,
        kind: "text",
        text: "Keep this channel history",
        createdAt: Date.now(),
      },
      alice,
    );
    assert.equal(sent.statusCode, 200, sent.body);
    const replyId = randomUUID();
    await req(
      "POST",
      `/api/threads/${issueId}/replies`,
      { id: replyId, text: "Keep this follow-up", createdAt: Date.now() },
      alice,
    );
    const broadcast = (
      await req("POST", "/api/admin/broadcasts", { teamIds: [stage.id] }, admin)
    ).json();
    const everyone = (
      await req(
        "POST",
        "/api/admin/broadcasts",
        { teamIds: [], everyone: true },
        admin,
      )
    ).json();
    const privateChannel = (
      await req("POST", "/api/private", { userId: f.bob.user.id }, alice)
    ).json();
    f.closed.length = 0;
    assert.equal(
      (
        await req(
          "DELETE",
          `/api/admin/channels/${stage.channelId}`,
          undefined,
          alice,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (await req("DELETE", "/api/admin/channels/all-staff", undefined, admin))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await req(
          "DELETE",
          `/api/admin/channels/${privateChannel.id}`,
          undefined,
          admin,
        )
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await req(
          "DELETE",
          `/api/admin/channels/${stage.channelId}`,
          undefined,
          admin,
        )
      ).statusCode,
      200,
    );
    assert.ok(
      f.closed.some((room) =>
        room.includes(`:conversation-${stage.channelId}:`),
      ),
    );
    assert.ok(
      f.closed.some((room) =>
        room.includes(`:conversation-${privateChannel.id}:`),
      ),
    );
    assert.ok(
      f.closed.some((room) => room.includes(`:conversation-${broadcast.id}:`)),
    );
    assert.ok(
      !f.closed.some((room) => room.includes(`:conversation-${everyone.id}:`)),
    );
    const active = (
      await req("GET", "/api/conversations", undefined, alice)
    ).json();
    assert.ok(!active.some((c: any) => c.id === stage.channelId));
    assert.ok(active.some((c: any) => c.id === security.channelId));
    const ops = (await req("GET", "/api/operations", undefined, alice)).json();
    assert.deepEqual(
      ops.channelMemberships.map((t: any) => t.id),
      [security.id],
    );
    assert.ok(!ops.teams.some((t: any) => t.id === stage.id));
    assert.ok(ops.issues.some((i: any) => i.id === issueId));
    assert.equal(
      (
        await req(
          "GET",
          `/api/conversations/${stage.channelId}/messages`,
          undefined,
          alice,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await req(
          "POST",
          `/api/conversations/${stage.channelId}/media-token`,
          {},
          alice,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await req(
          "POST",
          "/api/admin/broadcasts",
          { teamIds: [stage.id] },
          admin,
        )
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await req(
          "PUT",
          `/api/admin/operational-assignments/${alice.user.id}`,
          { teamId: stage.id, assigned: true },
          admin,
        )
      ).statusCode,
      400,
    );
    assert.ok(
      (await req("GET", "/api/admin/overview", undefined, admin))
        .json()
        .channels.find((c: any) => c.id === stage.channelId).archived,
    );
    assert.equal(
      (
        await req(
          "POST",
          `/api/admin/channels/${stage.channelId}/restore`,
          {},
          alice,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await req(
          "POST",
          `/api/admin/channels/${stage.channelId}/restore`,
          {},
          admin,
        )
      ).statusCode,
      200,
    );
    assert.ok(
      (await req("GET", "/api/conversations", undefined, alice))
        .json()
        .some((c: any) => c.id === stage.channelId),
    );
    const restored = (
      await req(
        "GET",
        "/api/conversations/" + stage.channelId + "/messages",
        undefined,
        alice,
      )
    ).json();
    assert.ok(restored.messages.some((m: any) => m.id === messageId));
    assert.deepEqual(
      new Set(
        (await req("GET", "/api/operations", undefined, alice))
          .json()
          .channelMemberships.map((t: any) => t.id),
      ),
      new Set([stage.id, security.id]),
    );
    assert.ok(
      (await req("GET", `/api/threads/${issueId}`, undefined, alice))
        .json()
        .replies.some((r: any) => r.id === replyId),
    );
    assert.equal(
      (await req("DELETE", "/api/admin/channels/nonexistent", undefined, admin))
        .statusCode,
      404,
    );
  } finally {
    await f.cleanup();
  }
});
test("venue template is shared with mobile clients, retry safe and requires admin", async () => {
  const f = await fixture();
  try {
    const template = {
      floors: [
        {
          id: "example-test-floor-2",
          name: "Floor 2",
          zones: [
            { id: "example-test-hall-201", name: "Hall 201", x: 0.2, y: 0.3 },
          ],
        },
        { id: "example-test-floor-4", name: "Floor 4", zones: [] },
      ],
    };
    assert.equal(
      (await f.req("POST", "/api/admin/venue-template", template, f.alice))
        .statusCode,
      403,
    );
    const saved = await f.req(
      "POST",
      "/api/admin/venue-template",
      template,
      f.admin,
    );
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().floors.length, 2);
    await f.req(
      "PUT",
      "/api/admin/zones/example-test-hall-201",
      { name: "Updated hall", x: 0.4, y: 0.5 },
      f.admin,
    );
    assert.equal(
      (await f.req("POST", "/api/admin/venue-template", template, f.admin))
        .statusCode,
      200,
    );
    const ops = (
      await f.req("GET", "/api/operations", undefined, f.alice)
    ).json();
    assert.equal(
      ops.floors.filter((floor: any) => floor.id.startsWith("example-test-"))
        .length,
      2,
    );
    const zones = ops.zones.filter((zone: any) =>
      zone.id.startsWith("example-test-"),
    );
    assert.equal(zones.length, 1);
    assert.equal(zones[0].name, "Updated hall");
    assert.equal(ops.checkin, null);
    assert.equal(
      (
        await f.req(
          "POST",
          "/api/checkins",
          { id: randomUUID(), zoneId: zones[0].id, reportedAt: Date.now() },
          f.alice,
        )
      ).statusCode,
      200,
    );
    const checkedIn = (
      await f.req("GET", "/api/operations", undefined, f.alice)
    ).json().checkin;
    assert.equal(checkedIn.floor_id, "example-test-floor-2");
    assert.equal(checkedIn.zone_name, "Updated hall");
    assert.equal(
      (
        await f.req(
          "POST",
          "/api/admin/venue-template",
          { floors: [...template.floors, template.floors[0]] },
          f.admin,
        )
      ).statusCode,
      400,
    );
  } finally {
    await f.cleanup();
  }
});
test("broadcast preparation reuses canonical audiences and refreshes membership after ending", async () => {
  const f = await fixture();
  try {
    const prepare = async (teamIds: string[], everyone = false) => {
      const response = await f.req(
        "POST",
        "/api/admin/broadcasts",
        { teamIds, everyone },
        f.admin,
      );
      assert.equal(response.statusCode, 200, response.body);
      return response.json();
    };
    const first = await prepare([f.stage.id, f.security.id, f.stage.id]);
    assert.equal((await prepare([f.security.id, f.stage.id])).id, first.id);
    const stageOnly = await prepare([f.stage.id]);
    assert.notEqual(stageOnly.id, first.id);
    assert.equal(stageOnly.recipientCount, 2);
    await f.req(
      "POST",
      `/api/admin/broadcasts/${stageOnly.id}/end`,
      {},
      f.admin,
    );
    await f.req(
      "PUT",
      `/api/admin/operational-assignments/${f.bob.user.id}`,
      { teamId: f.security.id },
      f.admin,
    );
    const restarted = await prepare([f.stage.id, f.stage.id]);
    assert.equal(restarted.id, stageOnly.id);
    assert.equal(restarted.recipientCount, 1);
    assert.equal(
      (
        await f.req(
          "GET",
          `/api/conversations/${stageOnly.id}/messages`,
          undefined,
          f.bob,
        )
      ).statusCode,
      403,
    );
    const everyone = await prepare([], true);
    assert.equal((await prepare([f.stage.id], true)).id, everyone.id);
    assert.notEqual(everyone.id, first.id);
    const channels = (
      await f.req("GET", "/api/conversations", undefined, f.admin)
    ).json();
    assert.equal(
      channels.filter((c: any) => c.name.startsWith("Admin broadcast ·"))
        .length,
      3,
    );
  } finally {
    await f.cleanup();
  }
});
test("multiple channels preserve receive and talk access; removing one revokes only that channel", async () => {
  const f = await fixture();
  try {
    const { req, alice, admin, stage, security } = f;
    const update = (assigned: boolean) =>
      req(
        "PUT",
        `/api/admin/operational-assignments/${alice.user.id}`,
        { teamId: security.id, assigned },
        admin,
      );
    assert.equal((await update(true)).statusCode, 200);
    assert.equal((await update(true)).statusCode, 200);
    await f.connect(alice, [stage.channelId, security.channelId]);
    const channels = (
      await req("GET", "/api/conversations", undefined, alice)
    ).json();
    for (const cid of [stage.channelId, security.channelId]) {
      assert.equal(channels.find((c: any) => c.id === cid).pttAllowed, true);
      assert.equal(
        (await req("POST", `/api/conversations/${cid}/media-token`, {}, alice))
          .statusCode,
        200,
      );
    }
    assert.equal(
      (await req("GET", "/api/operations", undefined, alice)).json()
        .channelMemberships.length,
      2,
    );
    for (const cid of [stage.channelId, security.channelId]) {
      const burst = await req(
        "POST",
        `/api/conversations/${cid}/ptt`,
        {},
        alice,
      );
      assert.equal(burst.statusCode, 200, burst.body);
      await req(
        "POST",
        `/api/conversations/${cid}/ptt/release`,
        { leaseId: burst.json().leaseId },
        alice,
      );
    }
    assert.equal(
      (
        await req(
          "PUT",
          `/api/admin/operational-assignments/${alice.user.id}`,
          { teamId: security.id, assigned: false },
          alice,
        )
      ).statusCode,
      403,
    );
    const issueId = randomUUID();
    assert.equal(
      (
        await req(
          "POST",
          "/api/threads",
          {
            id: issueId,
            title: "Security update",
            description: "Check this channel",
            priority: "normal",
            audience: "team",
            teamId: security.id,
            createdAt: Date.now(),
          },
          alice,
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await req("GET", `/api/threads/${issueId}`, undefined, alice))
        .statusCode,
      200,
    );
    assert.equal((await update(false)).statusCode, 200);
    assert.equal(
      (
        await req(
          "POST",
          `/api/conversations/${security.channelId}/media-token`,
          {},
          alice,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await req(
          "POST",
          `/api/conversations/${stage.channelId}/media-token`,
          {},
          alice,
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await req("GET", `/api/threads/${issueId}`, undefined, alice))
        .statusCode,
      404,
    );
  } finally {
    await f.cleanup();
  }
});
test("single-channel database migration preserves assignments and supports multiple memberships", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kettoo-memberships-"));
  const path = join(directory, "database.sqlite");
  let store = new Store(path);
  try {
    store.run(
      "INSERT INTO users VALUES('volunteer','Volunteer','v@test.invalid','password','staff',1)",
    );
    for (const name of ["stage", "security"]) {
      store.run("INSERT INTO teams VALUES(?,?)", name, name);
      store.run(
        "INSERT INTO conversations(id,name,kind) VALUES(?,?,'channel')",
        name,
        name,
      );
      store.run("INSERT INTO operational_teams VALUES(?,?,1)", name, name);
    }
    store.db.exec(
      "DROP TABLE operational_assignments; CREATE TABLE operational_assignments(user_id TEXT PRIMARY KEY REFERENCES users(id),team_id TEXT NOT NULL REFERENCES operational_teams(team_id)); INSERT INTO operational_assignments VALUES('volunteer','stage');",
    );
    store.db.close();
    store = new Store(path);
    assert.equal(
      store.get(
        "SELECT team_id FROM operational_assignments WHERE user_id='volunteer'",
      ).team_id,
      "stage",
    );
    store.run(
      "INSERT INTO operational_assignments VALUES('volunteer','security')",
    );
    assert.equal(
      store.get(
        "SELECT COUNT(*) n FROM operational_assignments WHERE user_id='volunteer'",
      ).n,
      2,
    );
    assert.equal(store.all("PRAGMA foreign_key_check").length, 0);
    store.db.close();
    store = new Store(path);
    assert.equal(
      store.get(
        "SELECT COUNT(*) n FROM operational_assignments WHERE user_id='volunteer'",
      ).n,
      2,
    );
  } finally {
    store.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("legacy assignment replacement separates private PTT from chat/calls", async () => {
  const f = await fixture();
  try {
    const { req, alice, bob, carol, admin, stage, security } = f;
    const pair = (
      await req("POST", "/api/private", { userId: carol.user.id }, alice)
    ).json();
    await f.connect(alice, [stage.channelId, pair.id]);
    assert.equal(
      (
        await req(
          "POST",
          `/api/conversations/${pair.id}/media-token`,
          {},
          alice,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await req(
          "POST",
          `/api/conversations/${pair.id}/messages`,
          {
            id: randomUUID(),
            text: "Private text remains permitted",
            kind: "text",
            createdAt: Date.now(),
          },
          alice,
        )
      ).statusCode,
      200,
    );
    await f.connect(carol, [security.channelId]);
    assert.equal(
      (await req("POST", "/api/calls", { conversationId: pair.id }, alice))
        .statusCode,
      200,
    );
    const teammates = (
      await req("POST", "/api/private", { userId: bob.user.id }, alice)
    ).json();
    assert.equal(
      (
        await req(
          "POST",
          `/api/conversations/${teammates.id}/media-token`,
          {},
          alice,
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await req(
          "PUT",
          "/api/admin/operational-assignments/" + alice.user.id,
          { teamId: security.id },
          admin,
        )
      ).statusCode,
      200,
    );
    const cs = (
      await req("GET", "/api/conversations", undefined, alice)
    ).json();
    assert.ok(!cs.some((c: any) => c.id === stage.channelId));
    assert.ok(cs.some((c: any) => c.id === security.channelId));
    assert.equal(
      (
        await req(
          "POST",
          `/api/conversations/${teammates.id}/media-token`,
          {},
          alice,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await req(
          "PUT",
          `/api/admin/channels/${security.channelId}/members`,
          { memberIds: [] },
          admin,
        )
      ).statusCode,
      409,
    );
  } finally {
    await f.cleanup();
  }
});

test("floor removal is admin-only, clears zones and locations, and preserves issue history", async () => {
  const f = await fixture();
  try {
    const { req, admin, alice, floor, zone } = f;
    const iid = await f.create();
    const before = (
      await req("GET", `/api/threads/${iid}`, undefined, alice)
    ).json();
    const rid = randomUUID();
    await req(
      "POST",
      `/api/threads/${iid}/replies`,
      { id: rid, text: "Keep this follow-up", createdAt: Date.now() },
      alice,
    );
    await req(
      "POST",
      "/api/checkins",
      { id: randomUUID(), zoneId: zone.id, reportedAt: Date.now() },
      alice,
    );
    const other = (
      await req("POST", "/api/admin/floors", { name: "Other floor" }, admin)
    ).json();
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2/8AAAAASUVORK5CYII=",
      "base64",
    );
    const upload = await f.app.inject({
      method: "POST",
      url: `/api/phase2/floors/${floor.id}/files`,
      headers: {
        authorization: "Bearer " + admin.token,
        "content-type": "multipart/form-data; boundary=floor-removal",
      },
      payload: Buffer.concat([
        Buffer.from(
          '--floor-removal\r\nContent-Disposition: form-data; name="file"; filename="plan.png"\r\nContent-Type: image/png\r\n\r\n',
        ),
        image,
        Buffer.from("\r\n--floor-removal--\r\n"),
      ]),
    });
    assert.equal(upload.statusCode, 200, upload.body);
    assert.equal(
      (await req("DELETE", `/api/admin/floors/${floor.id}`, undefined, alice))
        .statusCode,
      403,
    );
    const removed = await req(
      "DELETE",
      `/api/admin/floors/${floor.id}`,
      undefined,
      admin,
    );
    assert.equal(removed.statusCode, 200, removed.body);
    assert.deepEqual(removed.json(), {
      ok: true,
      removedZones: 1,
      clearedCheckins: 1,
    });
    const data = (await req("GET", "/api/operations", undefined, admin)).json();
    assert.ok(!data.floors.some((x: any) => x.id === floor.id));
    assert.ok(data.floors.some((x: any) => x.id === other.id));
    assert.ok(!data.zones.some((x: any) => x.id === zone.id));
    assert.equal(
      (await req("GET", "/api/operations", undefined, alice)).json().checkin,
      null,
    );
    const retained = (
      await req("GET", `/api/threads/${iid}`, undefined, alice)
    ).json();
    assert.equal(retained.zone_id, null);
    assert.equal(retained.title, before.title);
    assert.ok(retained.replies.some((r: any) => r.id === rid));
    assert.equal(
      (
        await req(
          "GET",
          `/api/phase2/files/${upload.json().id}`,
          undefined,
          admin,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await req(
          "POST",
          "/api/checkins",
          { id: randomUUID(), zoneId: zone.id, reportedAt: Date.now() },
          alice,
        )
      ).statusCode,
      400,
    );
    assert.equal(
      (await req("DELETE", `/api/admin/floors/${floor.id}`, undefined, admin))
        .statusCode,
      404,
    );
  } finally {
    await f.cleanup();
  }
});
test("floor and restricted issue images are authenticated, durable and pause for PTT", async () => {
  const f = await fixture();
  try {
    const iid = await f.create();
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2/8AAAAASUVORK5CYII=",
      "base64",
    );
    const upload = (
      scope: string,
      sid: string,
      u: any,
      bytes = image,
      mime = "image/png",
    ) => {
      const boundary = "phase2-test-image";
      return f.app.inject({
        method: "POST",
        url: `/api/phase2/${scope}/${sid}/files`,
        headers: {
          authorization: "Bearer " + u.token,
          "content-type": "multipart/form-data; boundary=" + boundary,
        },
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: ${mime}\r\n\r\n`,
          ),
          bytes,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      });
    };
    assert.equal((await upload("floors", f.floor.id, f.alice)).statusCode, 403);
    const floor = await upload("floors", f.floor.id, f.admin);
    assert.equal(floor.statusCode, 200, floor.body);
    const photo = await upload("issues", iid, f.alice);
    assert.equal(photo.statusCode, 200, photo.body);
    const beforeRetry = (
      await f.req("GET", "/api/threads/" + iid, undefined, f.alice)
    ).json().version;
    assert.equal(
      (await upload("issues", iid, f.alice)).json().id,
      photo.json().id,
      "Retry reuses the stored image",
    );
    assert.equal(
      (await f.req("GET", "/api/threads/" + iid, undefined, f.alice)).json()
        .version,
      beforeRetry,
      "Image retry does not change ownership version",
    );
    assert.equal((await upload("issues", iid, f.carol)).statusCode, 404);
    assert.equal(
      (
        await f.req(
          "GET",
          "/api/phase2/files/" + photo.json().id,
          undefined,
          f.carol,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await f.req(
          "GET",
          "/api/phase2/files/" + floor.json().id,
          undefined,
          f.carol,
        )
      ).statusCode,
      200,
    );
    const downloaded = await f.req(
      "GET",
      "/api/phase2/files/" + photo.json().id,
      undefined,
      f.bob,
    );
    assert.deepEqual(downloaded.rawPayload, image);
    assert.equal(
      (await upload("issues", iid, f.alice, Buffer.from("invalid image")))
        .statusCode,
      415,
    );
    await f.connect(f.bob, [f.stage.channelId]);
    const lease = await f.req(
      "POST",
      `/api/conversations/${f.stage.channelId}/ptt`,
      {},
      f.bob,
    );
    assert.equal(lease.statusCode, 200, lease.body);
    const cs = (
      await f.req("GET", "/api/conversations", undefined, f.alice)
    ).json();
    const speaker = cs.find((c: any) => c.id === f.stage.channelId).speaker;
    assert.equal(speaker.speakerName, "Bob");
    assert.equal(speaker.leaseId, undefined);
    assert.equal(
      (await upload("issues", iid, f.alice)).statusCode,
      503,
      "Another speaker pauses background image traffic",
    );
    await f.req(
      "POST",
      `/api/conversations/${f.stage.channelId}/ptt/release`,
      { leaseId: lease.json().leaseId },
      f.bob,
    );
    assert.equal((await upload("issues", iid, f.alice)).statusCode, 200);
    f.closeSockets();
    await f.app.close();
    const restarted = await buildApp({ dataDir: f.directory });
    await restarted.ready();
    try {
      const r = await restarted.inject({
        method: "GET",
        url: "/api/threads/" + iid,
        headers: { authorization: "Bearer " + f.alice.token },
      });
      assert.equal(r.statusCode, 200, r.body);
      assert.equal(r.json().photo_id, photo.json().id);
    } finally {
      await restarted.close();
    }
  } finally {
    await f.cleanup();
  }
});

test("an existing team can gain an operational channel without inferring volunteer assignments", async () => {
  const f = await fixture();
  try {
    const legacy = (
      await f.req("POST", "/api/admin/teams", { name: "Logistics" }, f.admin)
    ).json();
    assert.equal(
      (
        await f.req(
          "PUT",
          `/api/admin/teams/${legacy.id}/members`,
          { memberIds: [f.alice.user.id] },
          f.admin,
        )
      ).statusCode,
      200,
    );
    const response = await f.req(
      "POST",
      "/api/admin/operational-teams",
      { name: "Logistics" },
      f.admin,
    );
    assert.equal(response.statusCode, 200, response.body);
    const operational = response.json();
    assert.equal(operational.id, legacy.id);
    const data = (
      await f.req("GET", "/api/operations", undefined, f.alice)
    ).json();
    assert.equal(data.team.id, f.stage.id);
    const conversations = (
      await f.req("GET", "/api/conversations", undefined, f.alice)
    ).json();
    assert.ok(!conversations.some((c: any) => c.id === operational.channelId));
    assert.equal(
      (
        await f.req(
          "POST",
          "/api/admin/operational-teams",
          { name: "Logistics" },
          f.admin,
        )
      ).statusCode,
      409,
    );
  } finally {
    await f.cleanup();
  }
});

test("additive Phase 2 database migration preserves existing communicator records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kettoo-v1-migrate-"));
  const path = join(directory, "kettoo.sqlite");
  try {
    const v1 = new DatabaseSync(path);
    v1.exec(
      `CREATE TABLE teams(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE);INSERT INTO teams VALUES('old-team','Existing team');CREATE TABLE conversations(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('channel','private','broadcast')),pair TEXT UNIQUE);INSERT INTO conversations VALUES('old-channel','Existing channel','channel',NULL);`,
    );
    v1.close();
    const migrated = new Store(path);
    assert.equal(
      migrated.get("SELECT name FROM teams WHERE id='old-team'").name,
      "Existing team",
    );
    assert.equal(
      migrated.get("SELECT name FROM conversations WHERE id='old-channel'")
        .name,
      "Existing channel",
    );
    assert.equal(
      migrated.get("SELECT COUNT(*) n FROM operational_assignments").n,
      0,
    );
    migrated.db.close();
    const again = new Store(path);
    assert.equal(
      again.get("SELECT COUNT(*) n FROM conversations WHERE id='old-channel'")
        .n,
      1,
    );
    again.db.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("broadcast interrupts only its audience and reports recipients in accepted calls as busy", async () => {
  const f = await fixture();
  try {
    await f.connect(f.admin, [f.stage.channelId, f.security.channelId]);
    await f.connect(f.alice, [f.stage.channelId]);
    await f.connect(f.carol, [f.security.channelId]);
    const stageLease = await f.req(
      "POST",
      `/api/conversations/${f.stage.channelId}/ptt`,
      {},
      f.alice,
    );
    assert.equal(stageLease.statusCode, 200, stageLease.body);
    const securityLease = await f.req(
      "POST",
      `/api/conversations/${f.security.channelId}/ptt`,
      {},
      f.carol,
    );
    assert.equal(securityLease.statusCode, 200, securityLease.body);
    const broadcast = (
      await f.req(
        "POST",
        "/api/admin/broadcasts",
        { teamIds: [f.stage.id] },
        f.admin,
      )
    ).json();
    await f.connect(f.admin, [broadcast.id]);
    const lease = await f.req(
      "POST",
      `/api/conversations/${broadcast.id}/ptt`,
      {},
      f.admin,
    );
    assert.equal(lease.statusCode, 200, lease.body);
    const stage = (
      await f.req(
        "GET",
        `/api/conversations/${f.stage.channelId}/messages`,
        undefined,
        f.admin,
      )
    ).json();
    assert.equal(
      stage.messages.find((x: any) => x.id === stageLease.json().message)
        .status,
      "interrupted",
    );
    assert.equal(
      (
        await f.req(
          "POST",
          `/api/conversations/${f.security.channelId}/ptt/renew`,
          { leaseId: securityLease.json().leaseId },
          f.carol,
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await f.req(
          "POST",
          `/api/conversations/${f.stage.channelId}/ptt`,
          {},
          f.alice,
        )
      ).statusCode,
      409,
    );
    await f.req(
      "POST",
      `/api/conversations/${broadcast.id}/ptt/release`,
      { leaseId: lease.json().leaseId },
      f.admin,
    );
    await f.req(
      "POST",
      `/api/conversations/${f.security.channelId}/ptt/release`,
      { leaseId: securityLease.json().leaseId },
      f.carol,
    );
    const pair = (
      await f.req("POST", "/api/private", { userId: f.carol.user.id }, f.alice)
    ).json();
    const call = await f.req(
      "POST",
      "/api/calls",
      { conversationId: pair.id },
      f.alice,
    );
    assert.equal(call.statusCode, 200, call.body);
    assert.equal(
      (await f.req("POST", `/api/calls/${call.json().id}/accept`, {}, f.carol))
        .statusCode,
      200,
    );
    const next = await f.req(
      "POST",
      `/api/conversations/${broadcast.id}/ptt`,
      {},
      f.admin,
    );
    assert.equal(next.statusCode, 200, next.body);
    assert.equal(
      next.json().audience.find((u: any) => u.userId === f.alice.user.id).state,
      "busy",
    );
    await f.req("POST", `/api/calls/${call.json().id}/end`, {}, f.alice);
    await f.req(
      "POST",
      `/api/conversations/${broadcast.id}/ptt/release`,
      { leaseId: next.json().leaseId },
      f.admin,
    );
  } finally {
    await f.cleanup();
  }
});

test("admin reassignment checks audience and reopening clears the previous owner", async () => {
  const f = await fixture();
  try {
    const iid = await f.create();
    let x = (
      await f.req("GET", "/api/threads/" + iid, undefined, f.admin)
    ).json();
    assert.equal(
      (
        await f.req(
          "POST",
          `/api/threads/${iid}/reassign`,
          { version: x.version, ownerId: f.bob.user.id },
          f.alice,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.req(
          "POST",
          `/api/threads/${iid}/reassign`,
          { version: x.version, ownerId: f.carol.user.id },
          f.admin,
        )
      ).statusCode,
      400,
    );
    const assigned = await f.req(
      "POST",
      `/api/threads/${iid}/reassign`,
      { version: x.version, ownerId: f.bob.user.id },
      f.admin,
    );
    assert.equal(assigned.statusCode, 200, assigned.body);
    x = assigned.json();
    assert.equal(x.status, "in_progress");
    const resolved = await f.req(
      "POST",
      `/api/threads/${iid}/resolve`,
      { version: x.version },
      f.bob,
    );
    assert.equal(resolved.statusCode, 200, resolved.body);
    x = resolved.json();
    const reopened = await f.req(
      "POST",
      `/api/threads/${iid}/reopen`,
      { version: x.version },
      f.admin,
    );
    assert.equal(reopened.statusCode, 200, reopened.body);
    assert.equal(reopened.json().owner_id, null);
    assert.equal(reopened.json().status, "open");
  } finally {
    await f.cleanup();
  }
});
test("private admin exchange serializes competing volunteers and releases busy state", async () => {
  const f = await fixture();
  try {
    const { req, admin, alice, bob } = f;
    await req(
      "PUT",
      "/api/admin/duty-admin",
      { userId: admin.user.id, deviceId: admin.deviceId },
      admin,
    );
    await f.connect(admin, []);
    await f.connect(alice, [f.stage.channelId]);
    await f.connect(bob, [f.stage.channelId]);
    const replies = await Promise.all([
      req("POST", "/api/admin-exchange", {}, alice),
      req("POST", "/api/admin-exchange", {}, bob),
    ]);
    assert.deepEqual(replies.map((r) => r.statusCode).sort(), [200, 409]);
    const winner = replies[0].statusCode === 200 ? alice : bob,
      exchange = replies.find((r) => r.statusCode === 200)!.json();
    assert.equal(
      (
        await req(
          "POST",
          `/api/conversations/${exchange.conversation_id}/media-token`,
          {},
          winner,
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await req(
          "POST",
          `/api/conversations/${exchange.conversation_id}/media-token`,
          {},
          f.carol,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await req(
          "POST",
          "/api/admin/broadcasts",
          { teamIds: [f.stage.id] },
          admin,
        )
      ).statusCode,
      409,
    );
    await req("POST", "/api/admin-exchange/end", {}, admin);
    assert.equal(
      (await req("POST", "/api/admin-exchange", {}, bob)).statusCode,
      200,
    );
  } finally {
    await f.cleanup();
  }
});
test("restricted issues, replies and map counts are invisible across teams; ownership is atomic", async () => {
  const f = await fixture();
  try {
    const { req, alice, bob, carol, admin } = f,
      id = await f.create();
    const denied = await req("GET", "/api/threads/" + id, undefined, carol);
    assert.equal(denied.statusCode, 404);
    let ops = (await req("GET", "/api/operations", undefined, carol)).json();
    assert.equal(ops.issues.length, 0);
    assert.equal(ops.zones[0].openIssues, 0);
    const claims = await Promise.all([
      req("POST", `/api/threads/${id}/claim`, { version: 1 }, alice),
      req("POST", `/api/threads/${id}/claim`, { version: 1 }, bob),
    ]);
    assert.deepEqual(claims.map((r) => r.statusCode).sort(), [200, 409]);
    const thread = (
      await req("GET", "/api/threads/" + id, undefined, admin)
    ).json();
    assert.ok([alice.user.id, bob.user.id].includes(thread.owner_id));
    const reply = {
      id: randomUUID(),
      text: "Moving equipment",
      createdAt: Date.now(),
    };
    await req("POST", `/api/threads/${id}/replies`, reply, bob);
    await req("POST", `/api/threads/${id}/replies`, reply, bob);
    let t = (await req("GET", "/api/threads/" + id, undefined, admin)).json();
    assert.equal(t.replies.length, 1);
    assert.equal(
      (
        await req(
          "POST",
          `/api/threads/${id}/resolve`,
          { version: t.version },
          alice,
        )
      ).statusCode,
      200,
    );
    ops = (await req("GET", "/api/operations", undefined, admin)).json();
    assert.equal(ops.zones[0].openIssues, 0);
    t = (await req("GET", "/api/threads/" + id, undefined, admin)).json();
    await req(
      "POST",
      `/api/threads/${id}/reopen`,
      { version: t.version },
      admin,
    );
    t = (await req("GET", "/api/threads/" + id, undefined, admin)).json();
    assert.equal(t.status, "open");
    assert.equal(t.owner_id, null);
    assert.equal(t.replies.length, 1);
  } finally {
    await f.cleanup();
  }
});
test("queued check-ins and thread creation deduplicate; delayed location cannot overwrite newer location", async () => {
  const f = await fixture();
  try {
    const { req, alice, admin } = f,
      id = await f.create();
    assert.ok(id);
    const zone2 = (
      await req(
        "POST",
        "/api/admin/zones",
        { floorId: f.floor.id, name: "Entrance", x: 0.7, y: 0.2 },
        admin,
      )
    ).json();
    const now = Date.now(),
      one = { id: randomUUID(), zoneId: f.zone.id, reportedAt: now };
    await req("POST", "/api/checkins", one, alice);
    await req("POST", "/api/checkins", one, alice);
    await req(
      "POST",
      "/api/checkins",
      { id: randomUUID(), zoneId: zone2.id, reportedAt: now - 10000 },
      alice,
    );
    await f.connect(alice, [f.stage.channelId]);
    let ops = (await req("GET", "/api/operations", undefined, admin)).json();
    assert.equal(
      ops.volunteers.find((v: any) => v.id === alice.user.id).checkin.zone_id,
      f.zone.id,
    );
    assert.equal(ops.zones.find((z: any) => z.id === f.zone.id).volunteers, 1);
    assert.equal(
      (
        await req(
          "POST",
          "/api/admin/zones",
          { floorId: f.floor.id, name: "Bad", x: 1.5, y: 0.2 },
          admin,
        )
      ).statusCode,
      400,
    );
  } finally {
    await f.cleanup();
  }
});
test("selected-team broadcast audience excludes other teams and includes each listener once", async () => {
  const f = await fixture();
  try {
    const { req, admin, alice, bob, carol, stage } = f;
    const b = (
      await req(
        "POST",
        "/api/admin/broadcasts",
        { teamIds: [stage.id, stage.id] },
        admin,
      )
    ).json();
    assert.equal(b.recipientCount, 2);
    await f.connect(alice, [stage.channelId, b.id]);
    await f.connect(bob, [stage.channelId, b.id]);
    await f.connect(carol, [f.security.channelId]);
    await f.connect(admin, [b.id]);
    assert.equal(
      (await req("POST", `/api/conversations/${b.id}/media-token`, {}, carol))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await req(
          "GET",
          `/api/conversations/${b.id}/messages`,
          undefined,
          carol,
        )
      ).statusCode,
      403,
    );
    const lease = await req(
      "POST",
      `/api/conversations/${b.id}/ptt`,
      {},
      admin,
    );
    assert.equal(lease.statusCode, 200, lease.body);
    assert.equal(lease.json().audience.length, 2);
    assert.equal(
      (
        await req(
          "POST",
          `/api/conversations/${f.security.channelId}/ptt`,
          {},
          carol,
        )
      ).statusCode,
      200,
    );
    await req(
      "POST",
      `/api/conversations/${b.id}/ptt/release`,
      { leaseId: lease.json().leaseId },
      admin,
    );
    await req("POST", `/api/admin/broadcasts/${b.id}/end`, {}, admin);
    assert.equal(
      (await req("POST", `/api/conversations/${b.id}/media-token`, {}, alice))
        .statusCode,
      403,
    );
  } finally {
    await f.cleanup();
  }
});
