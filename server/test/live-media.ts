/** Optional integration check against a real organisation-hosted LiveKit server.
 * Uses generated tone frames, never a physical microphone. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
import { RoomServiceClient } from "livekit-server-sdk";
import { buildApp } from "../src/app.js";

if (
  !process.env.LIVEKIT_URL ||
  !process.env.LIVEKIT_API_KEY ||
  !process.env.LIVEKIT_API_SECRET
)
  throw new Error(
    "Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to a local media service.",
  );
const data = await mkdtemp(join(tmpdir(), "kettoo-media-test-"));
const app = await buildApp({
  dataDir: data,
  adminPassword: "local-media-test-password",
});
await app.ready();
const api = async (method: any, url: string, body?: unknown, u?: any) => {
  const r = await app.inject({
    method,
    url,
    payload: body,
    headers: u ? { authorization: "Bearer " + u.token } : {},
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const admin = await api("POST", "/api/login", {
  email: "admin@kettoo.local",
  password: "local-media-test-password",
});
const users: any[] = [];
const rooms: Room[] = [];
const sockets: any[] = [];
const readers: any[] = [];
let audio: AudioSource | undefined;
let track: LocalAudioTrack | undefined;
let renew: ReturnType<typeof setInterval> | undefined;
let channel = "";
let mediaRoom = "";
let lease: any;
const management = new RoomServiceClient(
  process.env.LIVEKIT_INTERNAL_URL ||
    process.env.LIVEKIT_URL.replace(/^ws/, "http"),
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET,
);
try {
  for (const name of ["Transmitter", "ListenerOne", "ListenerTwo"]) {
    const r = await api("POST", "/api/register", {
      name,
      email: name + "@local.test",
      password: "local-media-test-password",
      deviceName: "Synthetic test device",
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
    users.push({
      ...(await api("POST", "/api/login", {
        email: name + "@local.test",
        password: "local-media-test-password",
        deviceId: r.deviceId,
      })),
      id: r.userId,
    });
  }
  channel = (
    await api(
      "POST",
      "/api/admin/channels",
      { name: "Live audio verification" },
      admin,
    )
  ).id;
  await api(
    "PUT",
    `/api/admin/channels/${channel}/members`,
    { memberIds: users.map((u) => u.id) },
    admin,
  );
  const heard = new Map<
    number,
    { frames: number; nonSilent: number; at: number }
  >();
  for (let index = 0; index < users.length; index++) {
    const u = users[index];
    const ticket = (await api("POST", "/api/ws-ticket", {}, u)).ticket;
    const socket = await app.injectWS("/api/events?ticket=" + ticket);
    sockets.push(socket);
    socket.send(JSON.stringify({ type: "heartbeat", onDuty: true, rooms: [] }));
    await pause(30);
    const grant = await api(
      "POST",
      `/api/conversations/${channel}/media-token`,
      {},
      u,
    );
    const room = new Room();
    mediaRoom = grant.room;
    rooms.push(room);
    if (index > 0)
      room.on(RoomEvent.TrackSubscribed, (remote: any) => {
        const stream = new AudioStream(remote, {
          sampleRate: 16000,
          numChannels: 1,
        });
        const reader = stream.getReader();
        readers.push(reader);
        void (async () => {
          try {
            while (true) {
              const r = await reader.read();
              if (r.done) break;
              const previous = heard.get(index) || {
                frames: 0,
                nonSilent: 0,
                at: 0,
              };
              const audible = r.value.data.some(
                (n: number) => Math.abs(n) > 50,
              );
              heard.set(index, {
                frames: previous.frames + 1,
                nonSilent: previous.nonSilent + (audible ? 1 : 0),
                at: audible && !previous.at ? Date.now() : previous.at,
              });
            }
          } catch {}
        })();
      });
    await room.connect(grant.url, grant.token, { autoSubscribe: true });
    socket.send(
      JSON.stringify({ type: "heartbeat", onDuty: true, rooms: [channel] }),
    );
    await pause(50);
  }
  const before = await management.listParticipants(mediaRoom);
  assert.equal(before.length, 3);
  assert.ok(
    before.every((p) => !p.permission?.canPublish),
    "Receive tokens must not grant microphone publishing",
  );
  lease = await api("POST", `/api/conversations/${channel}/ptt`, {}, users[0]);
  renew = setInterval(
    () =>
      void api(
        "POST",
        `/api/conversations/${channel}/ptt/renew`,
        { leaseId: lease.leaseId },
        users[0],
      ),
    2000,
  );
  await pause(250);
  audio = new AudioSource(16000, 1);
  track = LocalAudioTrack.createAudioTrack(
    "Generated verification tone",
    audio,
  );
  const options = new TrackPublishOptions();
  options.source = TrackSource.SOURCE_MICROPHONE;
  await rooms[0].localParticipant!.publishTrack(track, options);
  const began = Date.now();
  for (let frame = 0; frame < 250; frame++) {
    const samples = new Int16Array(160);
    for (let i = 0; i < 160; i++)
      samples[i] = Math.round(
        9000 * Math.sin((2 * Math.PI * 440 * (frame * 160 + i)) / 16000),
      );
    await audio.captureFrame(new AudioFrame(samples, 16000, 1, 160));
    await pause(10);
    if (frame >= 100 && [1, 2].every((i) => (heard.get(i)?.nonSilent || 0) > 5))
      break;
  }
  assert.ok(
    [1, 2].every((i) => (heard.get(i)?.nonSilent || 0) > 5),
    "Both listeners must receive actual non-silent frames before release",
  );
  assert.ok(heard.get(1)!.at > began && heard.get(2)!.at > began);
  console.log(
    JSON.stringify({
      test: "three-client channel PTT",
      result: "passed",
      firstAudioDelayMs: [1, 2].map((i) => heard.get(i)!.at - began),
      receivedFrames: [1, 2].map((i) => heard.get(i)!.frames),
    }),
  );
  clearInterval(renew);
  renew = undefined;
  await api(
    "POST",
    `/api/conversations/${channel}/ptt/release`,
    { leaseId: lease.leaseId },
    users[0],
  );
  lease = undefined;
  const after = await management.listParticipants(mediaRoom);
  assert.ok(
    after.every((p) => !p.permission?.canPublish),
    "Release must revoke media-server publishing permission",
  );
  assert.ok(
    after.every((p) => p.tracks.length === 0),
    "Release must unpublish the live microphone track",
  );
  console.log(
    JSON.stringify({
      test: "release revokes actual media permissions",
      result: "passed",
    }),
  );
} finally {
  if (renew) clearInterval(renew);
  if (lease)
    await api(
      "POST",
      `/api/conversations/${channel}/ptt/release`,
      { leaseId: lease.leaseId },
      users[0],
    ).catch(() => {});
  for (const reader of readers) await reader.cancel().catch(() => {});
  for (const room of rooms) await room.disconnect();
  if (track) await track.close();
  if (audio) await audio.close();
  if (channel) await management.deleteRoom(mediaRoom).catch(() => {});
  sockets.forEach((s) => s.close());
  await app.close();
  await dispose();
  await rm(data, { recursive: true, force: true });
}
