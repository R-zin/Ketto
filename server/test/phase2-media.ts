/** Actual LiveKit audience/isolation test. Uses generated frames, no microphone. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
  dispose,
} from "@livekit/rtc-node";
import { buildApp } from "../src/app.js";
const directory = await mkdtemp(join(tmpdir(), "phase2-live-"));
const app = await buildApp({
  dataDir: directory,
  adminPassword: "phase2-live-test-password",
});
await app.ready();
const clients: any[] = [];
const readers: any[] = [];
const heard = new Map<string, number>();
let active: any;
const request = async (method: any, url: string, body?: any, u?: any) =>
  app.inject({
    method,
    url,
    payload: body,
    headers: u ? { authorization: "Bearer " + u.token } : {},
  });
const api = async (method: any, url: string, body?: any, u?: any) => {
  const r = await request(method, url, body, u);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
async function connect(u: any, cid: string) {
  const grant = await api(
    "POST",
    `/api/conversations/${cid}/media-token`,
    {},
    u,
  );
  const room = new Room();
  clients.push({ room, cid, u });
  room.on(RoomEvent.TrackSubscribed, (track: any) => {
    const stream = new AudioStream(track, {
        sampleRate: 16000,
        numChannels: 1,
      }),
      reader = stream.getReader();
    readers.push(reader);
    void (async () => {
      try {
        while (true) {
          const r = await reader.read();
          if (r.done) break;
          if (r.value.data.some((n: number) => Math.abs(n) > 50))
            heard.set(
              cid + ":" + u.user.id,
              (heard.get(cid + ":" + u.user.id) || 0) + 1,
            );
        }
      } catch {}
    })();
  });
  await room.connect(grant.url, grant.token, { autoSubscribe: true });
  u.rooms.add(cid);
  u.ws.send(
    JSON.stringify({ type: "heartbeat", onDuty: true, rooms: [...u.rooms] }),
  );
  await pause(80);
  return room;
}
async function tone(
  u: any,
  cid: string,
  room: Room,
  listeners: any[],
  excluded: any[],
) {
  const before = new Map(heard);
  const lease = await api("POST", `/api/conversations/${cid}/ptt`, {}, u);
  active = { u, cid, lease };
  await pause(250);
  const source = new AudioSource(16000, 1),
    track = LocalAudioTrack.createAudioTrack("Generated Phase 2 tone", source),
    options = new TrackPublishOptions();
  options.source = TrackSource.SOURCE_MICROPHONE;
  let renew: ReturnType<typeof setInterval> | undefined;
  let publication: any;
  try {
    publication = await room.localParticipant!.publishTrack(track, options);
    renew = setInterval(
      () =>
        void api(
          "POST",
          `/api/conversations/${cid}/ptt/renew`,
          { leaseId: lease.leaseId },
          u,
        ),
      2000,
    );
    for (let n = 0; n < 160; n++) {
      const pcm = new Int16Array(160);
      for (let i = 0; i < 160; i++)
        pcm[i] = Math.round(
          7000 * Math.sin((2 * Math.PI * 440 * (n * 160 + i)) / 16000),
        );
      await source.captureFrame(new AudioFrame(pcm, 16000, 1, 160));
      await pause(10);
    }
    const decoded = () =>
      listeners.every(
        (listener) =>
          (heard.get(cid + ":" + listener.user.id) || 0) -
            (before.get(cid + ":" + listener.user.id) || 0) >
          5,
      );
    const decodeDeadline = Date.now() + 3000;
    while (!decoded() && Date.now() < decodeDeadline) await pause(30);
    for (const listener of listeners)
      assert.ok(
        (heard.get(cid + ":" + listener.user.id) || 0) -
          (before.get(cid + ":" + listener.user.id) || 0) >
          5,
        `Selected recipient ${listener.user.name} must decode actual audio in ${cid}`,
      );
    for (const listener of excluded)
      assert.equal(
        heard.get(cid + ":" + listener.user.id) || 0,
        before.get(cid + ":" + listener.user.id) || 0,
        "Excluded recipient must receive no audio",
      );
    console.log(
      JSON.stringify({
        test: "scoped live PTT",
        room: cid,
        selected: listeners.length,
        excluded: excluded.length,
        received: listeners.map((listener) => ({
          name: listener.user.name,
          nonSilentFrames:
            (heard.get(cid + ":" + listener.user.id) || 0) -
            (before.get(cid + ":" + listener.user.id) || 0),
        })),
        result: "passed",
      }),
    );
  } finally {
    if (renew) clearInterval(renew);
    // Match the app lifecycle: unpublish locally before revoking the lease.
    if (publication)
      await room
        .localParticipant!.unpublishTrack(publication.sid)
        .catch(() => {});
    await api(
      "POST",
      `/api/conversations/${cid}/ptt/release`,
      { leaseId: lease.leaseId },
      u,
    ).catch(() => {});
    active = undefined;
    await track.close();
    await source.close();
    await pause(250);
  }
}
try {
  const admin = await api("POST", "/api/login", {
    email: "admin@kettoo.local",
    password: "phase2-live-test-password",
  });
  const stage = await api(
      "POST",
      "/api/admin/operational-teams",
      { name: "Stage" },
      admin,
    ),
    security = await api(
      "POST",
      "/api/admin/operational-teams",
      { name: "Security" },
      admin,
    ),
    entry = await api(
      "POST",
      "/api/admin/operational-teams",
      { name: "Entry" },
      admin,
    );
  const volunteers: any[] = [];
  for (const [name, team] of [
    ["StageOne", stage],
    ["StageTwo", stage],
    ["SecurityOne", security],
    ["EntryOne", entry],
  ] as any[]) {
    const r = await api("POST", "/api/register", {
      name,
      email: name + "@phase2.test",
      password: "phase2-live-test-password",
      deviceName: "Generated media client",
    });
    await api(
      "POST",
      `/api/admin/users/${r.userId}/approval`,
      { approved: true },
      admin,
    );
    await api(
      "POST",
      `/api/admin/devices/${r.deviceId}/approval`,
      { approved: true },
      admin,
    );
    const u = await api("POST", "/api/login", {
      email: name + "@phase2.test",
      password: "phase2-live-test-password",
      deviceId: r.deviceId,
    });
    u.team = team;
    volunteers.push(u);
    await api(
      "PUT",
      "/api/admin/operational-assignments/" + u.user.id,
      { teamId: team.id },
      admin,
    );
  }
  for (const u of [admin, ...volunteers]) {
    const ticket = (await api("POST", "/api/ws-ticket", {}, u)).ticket;
    u.ws = await app.injectWS("/api/events?ticket=" + ticket);
    u.rooms = new Set<string>();
    u.ws.send(JSON.stringify({ type: "heartbeat", onDuty: true, rooms: [] }));
    await pause(30);
  }
  for (const u of volunteers) await connect(u, u.team.channelId);
  for (const teamIds of [[stage.id], [stage.id, security.id], []]) {
    const everyone = !teamIds.length,
      b = await api(
        "POST",
        "/api/admin/broadcasts",
        { teamIds, everyone },
        admin,
      );
    const selected = volunteers.filter(
        (u) => everyone || teamIds.includes(u.team.id),
      ),
      excluded = volunteers.filter((u) => !selected.includes(u));
    for (const u of excluded)
      assert.equal(
        (await request("POST", `/api/conversations/${b.id}/media-token`, {}, u))
          .statusCode,
        403,
      );
    for (const u of selected) await connect(u, b.id);
    const transmitter = await connect(admin, b.id);
    await tone(admin, b.id, transmitter, selected, excluded);
    await api("POST", `/api/admin/broadcasts/${b.id}/end`, {}, admin);
    for (const client of clients.filter((x) => x.cid === b.id))
      await client.room.disconnect();
    for (const u of [admin, ...volunteers]) u.rooms.delete(b.id);
  }
  await api(
    "PUT",
    "/api/admin/duty-admin",
    { userId: admin.user.id, deviceId: admin.deviceId },
    admin,
  );
  const e = await api("POST", "/api/admin-exchange", {}, volunteers[0]);
  assert.equal(
    (await request("POST", "/api/admin-exchange", {}, volunteers[1]))
      .statusCode,
    409,
  );
  const vr = await connect(volunteers[0], e.conversation_id),
    ar = await connect(admin, e.conversation_id);
  await tone(
    volunteers[0],
    e.conversation_id,
    vr,
    [admin],
    volunteers.slice(1),
  );
  await tone(
    admin,
    e.conversation_id,
    ar,
    [volunteers[0]],
    volunteers.slice(1),
  );
  await api("POST", "/api/admin-exchange/end", {}, admin);
  console.log(
    JSON.stringify({
      test: "private admin report and reply",
      result: "passed",
    }),
  );
} finally {
  if (active)
    await api(
      "POST",
      `/api/conversations/${active.cid}/ptt/release`,
      { leaseId: active.lease.leaseId },
      active.u,
    ).catch(() => {});
  for (const reader of readers) await reader.cancel().catch(() => {});
  for (const client of clients) await client.room.disconnect().catch(() => {});
  await app.close();
  await dispose();
  await rm(directory, { recursive: true, force: true });
}
