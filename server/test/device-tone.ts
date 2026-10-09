import { audibleTestSample } from "./audible-test-sound.js";
import { readFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackPublishOptions,
  TrackSource,
  dispose,
} from "@livekit/rtc-node";
import WebSocket from "ws";
if (!process.env.KETTOO_DEVICE_CONTEXT) {
  throw new Error(
    "Set KETTOO_DEVICE_CONTEXT to the private, local phone-test context file.",
  );
}
const context = JSON.parse(
  await readFile(process.env.KETTOO_DEVICE_CONTEXT, "utf8"),
);
const targets = context.phones.filter(
  (p: any) =>
    !process.env.KETTOO_TARGET_PHONE ||
    p.email === process.env.KETTOO_TARGET_PHONE,
);
const base = (process.env.KETTOO_TEST_BASE || "http://127.0.0.1:8791") + "/api";
const auth = {
  Authorization: "Bearer " + context.admin.token,
  "Content-Type": "application/json",
};
const api = async (path: string, body?: unknown) => {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: auth,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const b = (await r.json()) as any;
  if (!r.ok) throw new Error(b.error);
  return b;
};
const socket = new WebSocket(
  base.replace(/^http/, "ws") +
    "/events?ticket=" +
    (await api("/ws-ticket", {})).ticket,
);
await new Promise<void>((resolve, reject) => {
  socket.once("open", () => resolve());
  socket.once("error", reject);
});
const beat = () =>
  socket.send(JSON.stringify({ type: "heartbeat", onDuty: true, rooms: [] }));
beat();
await pause(100);
const room = new Room();
let lease: any;
let renew: ReturnType<typeof setInterval> | undefined;
let source: AudioSource | undefined;
let track: LocalAudioTrack | undefined;
try {
  const until = Date.now() + 60000;
  while (true) {
    const o = await api("/admin/overview");
    const phones = o.users.filter((u: any) =>
      targets.some((p: any) => p.id === u.id),
    );
    if (
      phones.length === targets.length &&
      phones.every((u: any) =>
        u.devices.some(
          (d: any) => d.onDuty && d.rooms.includes(context.channel),
        ),
      )
    )
      break;
    if (Date.now() > until)
      throw new Error("Both phones did not become media-ready");
    await pause(500);
  }
  console.log(
    `${targets.length} actual phone(s) report connected receive rooms.`,
  );
  const grant = await api(`/conversations/${context.channel}/media-token`, {});
  await room.connect("ws://127.0.0.1:7880", grant.token, {
    autoSubscribe: true,
  });
  socket.send(
    JSON.stringify({
      type: "heartbeat",
      onDuty: true,
      rooms: [context.channel],
    }),
  );
  await pause(100);
  console.log(
    "Phone audio prepared; tone starts after a 15-second listening pause.",
  );
  await pause(15000);
  lease = await api(`/conversations/${context.channel}/ptt`, {});
  renew = setInterval(
    () =>
      void api(`/conversations/${context.channel}/ptt/renew`, {
        leaseId: lease.leaseId,
      }),
    2000,
  );
  await pause(200);
  source = new AudioSource(16000, 1);
  track = LocalAudioTrack.createAudioTrack("Phone acceptance tone", source);
  const options = new TrackPublishOptions();
  options.source = TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant!.publishTrack(track, options);
  for (let frame = 0; frame < 800; frame++) {
    const samples = new Int16Array(160);
    for (let i = 0; i < 160; i++)
      samples[i] = audibleTestSample(frame * 160 + i);
    await source.captureFrame(new AudioFrame(samples, 16000, 1, 160));
    await pause(10);
  }
  console.log(
    JSON.stringify({
      test: "real-phone receive",
      toneSent: true,
      audience: lease.audience,
    }),
  );
} finally {
  if (renew) clearInterval(renew);
  if (lease)
    await api(`/conversations/${context.channel}/ptt/release`, {
      leaseId: lease.leaseId,
    }).catch(() => {});
  await room.disconnect();
  if (track) await track.close();
  if (source) await source.close();
  socket.close();
  await dispose();
}
