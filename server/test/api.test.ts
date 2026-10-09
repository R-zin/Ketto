import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import type { Media } from "../src/media.js";
import { generateKeyPairSync, sign } from "node:crypto";
import { hash } from "../src/security.js";

let app: Awaited<ReturnType<typeof buildApp>>, directory: string;
let admin: any, alice: any, bob: any, outsider: any, channel: string;
const permissions: any[] = [];
const tokenRooms: string[] = [];
const media: Media = {
  configured: true,
  url: "wss://media.invalid",
  token: async (room) => {
    tokenRooms.push(room);
    return "test-token";
  },
  publishing: async (...args) => {
    permissions.push(args);
  },
  remove: async () => {},
  close: async () => {},
};
async function request(method: any, url: string, body?: any, user?: any) {
  return app.inject({
    method,
    url,
    payload: body,
    headers: user ? { authorization: "Bearer " + user.token } : {},
  });
}
const aliceKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
async function member(name: string, publicKey?: string) {
  const register = await request("POST", "/api/register", {
    name,
    email: name + "@example.test",
    password: "a-long-test-password",
    deviceName: "Phone",
    publicKey,
  });
  assert.equal(register.statusCode, 200);
  const r = register.json();
  assert.equal(
    (
      await request("POST", "/api/login", {
        email: name + "@example.test",
        password: "a-long-test-password",
        deviceId: r.deviceId,
      })
    ).statusCode,
    403,
  );
  await request(
    "POST",
    `/api/admin/users/${r.userId}/approval`,
    { approved: true },
    admin,
  );
  const pending = (
    await request("POST", "/api/login", {
      email: name + "@example.test",
      password: "a-long-test-password",
      deviceId: r.deviceId,
    })
  ).json();
  assert.equal(pending.pending, true);
  await request(
    "POST",
    `/api/admin/devices/${r.deviceId}/approval`,
    { approved: true },
    admin,
  );
  const login = await request("POST", "/api/login", {
    email: name + "@example.test",
    password: "a-long-test-password",
    deviceId: r.deviceId,
  });
  assert.equal(login.statusCode, 200);
  return { ...login.json(), id: r.userId };
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "kettoo-test-"));
  app = await buildApp({
    dataDir: directory,
    adminPassword: "admin-test-password",
    media,
  });
  app.addHook("onError", async (_req, _reply, error) => {
    if (!error.statusCode || error.statusCode >= 500)
      console.error(error.stack);
  });
  await app.ready();
  admin = (
    await request("POST", "/api/login", {
      email: "admin@kettoo.local",
      password: "admin-test-password",
    })
  ).json();
  alice = await member(
    "Alice",
    aliceKeys.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
  );
  bob = await member("Bobby");
  outsider = await member("Carol");
  channel = (
    await request("POST", "/api/admin/channels", { name: "Operations" }, admin)
  ).json().id;
  await request(
    "PUT",
    `/api/admin/channels/${channel}/members`,
    { memberIds: [admin.user.id, alice.id, bob.id] },
    admin,
  );
});
after(async () => {
  await app.close();
  await rm(directory, { recursive: true, force: true });
});
test("membership, admin role, and broadcast boundaries are enforced", async () => {
  assert.equal(
    (
      await request(
        "GET",
        `/api/conversations/${channel}/messages`,
        undefined,
        outsider,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await request("GET", "/api/admin/overview", undefined, alice)).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/api/conversations/all-staff/messages",
        {
          id: crypto.randomUUID(),
          kind: "text",
          text: "unauthorized broadcast",
          createdAt: Date.now(),
        },
        alice,
      )
    ).statusCode,
    403,
  );
  assert.equal((await request("GET", "/api/conversations")).statusCode, 401);
});
test("durable retry IDs deduplicate and receipt states never regress", async () => {
  const b = {
    id: crypto.randomUUID(),
    text: "Check entrance",
    createdAt: Date.now() - 60000,
  };
  const first = (
    await request("POST", `/api/conversations/${channel}/messages`, b, alice)
  ).json();
  const retry = (
    await request("POST", `/api/conversations/${channel}/messages`, b, alice)
  ).json();
  assert.equal(first.seq, retry.seq);
  assert.equal(first.delayed, 1);
  assert.equal(
    (await request("POST", `/api/conversations/${channel}/messages`, b, bob))
      .statusCode,
    409,
  );
  await request(
    "POST",
    `/api/messages/${b.id}/receipt`,
    { state: "acknowledged" },
    bob,
  );
  await request(
    "POST",
    `/api/messages/${b.id}/receipt`,
    { state: "received" },
    bob,
  );
  const history = (
    await request(
      "GET",
      `/api/conversations/${channel}/messages`,
      undefined,
      bob,
    )
  ).json().messages;
  assert.equal(history.length, 1);
  assert.equal(history[0].receipts[0].state, "acknowledged");
});
test("private conversations are pair-idempotent and isolated", async () => {
  const c = (
    await request("POST", "/api/private", { userId: bob.id }, alice)
  ).json();
  assert.equal(
    (await request("POST", "/api/private", { userId: alice.id }, bob)).json()
      .id,
    c.id,
  );
  assert.equal(
    (
      await request(
        "GET",
        `/api/conversations/${c.id}/messages`,
        undefined,
        outsider,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/api/conversations/${c.id}/media-token`,
        {},
        outsider,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        "GET",
        `/api/conversations/${c.id}/messages`,
        undefined,
        admin,
      )
    ).statusCode,
    403,
  );
});
test("organisations sharing a media service have distinct All Staff rooms", async () => {
  const otherDirectory = await mkdtemp(join(tmpdir(), "kettoo-other-org-"));
  const other = await buildApp({
    dataDir: otherDirectory,
    media,
    adminPassword: "another-long-test-password",
  });
  let primarySocket: any, otherSocket: any;
  try {
    const login = (
      await other.inject({
        method: "POST",
        url: "/api/login",
        payload: {
          email: "admin@kettoo.local",
          password: "another-long-test-password",
        },
      })
    ).json();
    const otherHeaders = { authorization: "Bearer " + login.token };
    const primaryTicket = (
      await request("POST", "/api/ws-ticket", {}, admin)
    ).json().ticket;
    const otherTicket = (
      await other.inject({
        method: "POST",
        url: "/api/ws-ticket",
        payload: {},
        headers: otherHeaders,
      })
    ).json().ticket;
    primarySocket = await app.injectWS("/api/events?ticket=" + primaryTicket);
    otherSocket = await other.injectWS("/api/events?ticket=" + otherTicket);
    for (const socket of [primarySocket, otherSocket])
      socket.send(
        JSON.stringify({ type: "heartbeat", onDuty: true, rooms: [] }),
      );
    await new Promise((resolve) => setTimeout(resolve, 30));
    const primaryGrant = await request(
      "POST",
      "/api/conversations/all-staff/media-token",
      {},
      admin,
    );
    const otherGrant = await other.inject({
      method: "POST",
      url: "/api/conversations/all-staff/media-token",
      payload: {},
      headers: otherHeaders,
    });
    assert.equal(primaryGrant.statusCode, 200);
    assert.equal(otherGrant.statusCode, 200);
    assert.notEqual(primaryGrant.json().room, otherGrant.json().room);
    assert.deepEqual(tokenRooms.slice(-2), [
      primaryGrant.json().room,
      otherGrant.json().room,
    ]);
    assert.match(
      primaryGrant.json().room,
      /^org-[a-f0-9]{64}:conversation-all-staff$/,
    );
  } finally {
    primarySocket?.close();
    otherSocket?.close();
    await other.close();
    await rm(otherDirectory, { recursive: true, force: true });
  }
});
test("speaking requires on-duty connected receive media; no pretend delivery", async () => {
  assert.equal(
    (await request("POST", `/api/conversations/${channel}/ptt`, {}, alice))
      .statusCode,
    409,
  );
  assert.equal(permissions.length, 0);
});
test("real websocket sessions serialize speakers and revoke on release", async () => {
  const connect = async (u: any) => {
    const t = (await request("POST", "/api/ws-ticket", {}, u)).json().ticket;
    const ws = await app.injectWS("/api/events?ticket=" + t);
    ws.send(
      JSON.stringify({ type: "heartbeat", onDuty: true, rooms: [channel] }),
    );
    await new Promise((r) => setTimeout(r, 20));
    return ws;
  };
  const wa = await connect(alice),
    wb = await connect(bob);
  try {
    const results = await Promise.all([
      request("POST", `/api/conversations/${channel}/ptt`, {}, alice),
      request("POST", `/api/conversations/${channel}/ptt`, {}, bob),
    ]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
    const winner = results[0].statusCode === 200 ? alice : bob;
    const lease = results.find((r) => r.statusCode === 200)!.json();
    assert.equal(
      (
        await request(
          "POST",
          `/api/conversations/${channel}/ptt/release`,
          { leaseId: "wrong" },
          winner,
        )
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await request(
          "POST",
          `/api/conversations/${channel}/ptt/release`,
          { leaseId: lease.leaseId },
          winner,
        )
      ).statusCode,
      200,
    );
    assert.equal(permissions.at(-1)[2], false);
  } finally {
    wa.close();
    wb.close();
  }
});
test("files need membership and a matching completed upload", async () => {
  assert.equal(
    (
      await request(
        "POST",
        `/api/conversations/${channel}/files`,
        undefined,
        outsider,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/api/conversations/${channel}/messages`,
        {
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          kind: "image",
          attachmentId: "missing",
        },
        alice,
      )
    ).statusCode,
    400,
  );
});
test("device revocation immediately denies API sessions", async () => {
  await request(
    "POST",
    `/api/admin/devices/${outsider.deviceId}/approval`,
    { approved: false },
    admin,
  );
  assert.equal(
    (await request("GET", "/api/people", undefined, outsider)).statusCode,
    401,
  );
});
test("untrusted origins and forged offline messages fail closed", async () => {
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: "/api/health",
        headers: { origin: "https://evil.example" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/api/offline/sync",
        { credential: "forged", envelope: "{}", signature: "bad" },
        alice,
      )
    ).statusCode,
    403,
  );
});

test("authenticated peer text sync keeps original identity and deduplicates", async () => {
  const issued = (
    await request("POST", "/api/offline/credential", {}, alice)
  ).json();
  const envelope = JSON.stringify({
    id: crypto.randomUUID(),
    conversationId: channel,
    kind: "text",
    text: "Nearby delivery",
    createdAt: Date.now() - 60000,
  });
  const signature = sign(
    "SHA256",
    Buffer.from(envelope),
    aliceKeys.privateKey,
  ).toString("base64");
  const body = { credential: issued.credential, envelope, signature };
  const result = await request("POST", "/api/offline/sync", body, bob);
  assert.equal(result.statusCode, 200, result.body);
  const m = result.json();
  assert.equal(m.sender_id, alice.id);
  assert.equal(m.delayed, 1);
  assert.ok(m.receipts.some((r: any) => r.user_id === bob.id));
  assert.equal(
    (await request("POST", "/api/offline/sync", body, bob)).json().seq,
    m.seq,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/api/offline/sync",
        {
          ...body,
          envelope: envelope.replace("Nearby delivery", "Forged delivery"),
        },
        bob,
      )
    ).statusCode,
    403,
  );
});

test("a recipient can sync a signed audio note only with matching bytes", async () => {
  const issued = (
    await request("POST", "/api/offline/credential", {}, alice)
  ).json();
  const audio = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypM4A "),
    Buffer.alloc(20),
  ]);
  const boundary = "kettoo-audio-test";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="peer.m4a"\r\nContent-Type: audio/mp4\r\n\r\n`,
    ),
    audio,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const uploaded = await app.inject({
    method: "POST",
    url: `/api/conversations/${channel}/files`,
    headers: {
      authorization: "Bearer " + bob.token,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  const envelope = JSON.stringify({
    id: crypto.randomUUID(),
    conversationId: channel,
    kind: "voice",
    createdAt: Date.now(),
    sha256: hash(audio),
    size: audio.length,
  });
  const signature = sign(
    "SHA256",
    Buffer.from(envelope),
    aliceKeys.privateKey,
  ).toString("base64");
  const body = {
    credential: issued.credential,
    envelope,
    signature,
    attachmentId: uploaded.json().id,
  };
  const result = await request("POST", "/api/offline/sync", body, bob);
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().sender_id, alice.id);
  assert.equal(
    (
      await request(
        "GET",
        "/api/files/" + uploaded.json().id,
        undefined,
        outsider,
      )
    ).statusCode,
    401,
  );
  const badEnvelope = JSON.stringify({
    ...JSON.parse(envelope),
    id: crypto.randomUUID(),
    sha256: "0".repeat(64),
  });
  const bad = await request(
    "POST",
    "/api/offline/sync",
    {
      ...body,
      envelope: badEnvelope,
      signature: sign(
        "SHA256",
        Buffer.from(badEnvelope),
        aliceKeys.privateKey,
      ).toString("base64"),
    },
    bob,
  );
  assert.equal(bad.statusCode, 400);
});

test("calls ring one device, reject an unrelated device, and enforce busy state", async () => {
  const connect = async (u: any) => {
    const ticket = (await request("POST", "/api/ws-ticket", {}, u)).json()
      .ticket;
    const ws = await app.injectWS("/api/events?ticket=" + ticket);
    ws.send(
      JSON.stringify({ type: "heartbeat", onDuty: true, rooms: [channel] }),
    );
    await new Promise((r) => setTimeout(r, 20));
    return ws;
  };
  const wa = await connect(alice),
    wb = await connect(bob);
  try {
    const cid = (
      await request("POST", "/api/private", { userId: bob.id }, alice)
    ).json().id;
    const call = (
      await request(
        "POST",
        "/api/calls",
        { conversationId: cid, video: false },
        alice,
      )
    ).json();
    assert.equal(call.state, "ringing");
    assert.equal(
      (await request("POST", `/api/calls/${call.id}/accept`, {}, admin))
        .statusCode,
      403,
    );
    assert.equal(
      (await request("POST", "/api/calls", { conversationId: cid }, alice))
        .statusCode,
      409,
    );
    assert.equal(
      (await request("POST", `/api/calls/${call.id}/accept`, {}, bob))
        .statusCode,
      200,
    );
    assert.equal(
      (await request("POST", `/api/calls/${call.id}/token`, {}, alice))
        .statusCode,
      200,
    );
    assert.equal(
      (await request("POST", `/api/calls/${call.id}/end`, {}, alice))
        .statusCode,
      200,
    );
    assert.equal(
      (await request("POST", `/api/calls/${call.id}/token`, {}, bob))
        .statusCode,
      409,
    );
  } finally {
    wa.close();
    wb.close();
  }
});
