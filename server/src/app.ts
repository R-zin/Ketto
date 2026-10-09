import Fastify from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { mkdirSync, existsSync, createReadStream } from "node:fs";
import { writeFile, rename, unlink } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verify } from "node:crypto";
import type { WebSocket } from "ws";
import { Store, id } from "./db.js";
import {
  hash,
  passwordHash,
  passwordMatches,
  token,
  Credentials,
} from "./security.js";
import { liveMedia, type Media } from "./media.js";
import { registerPhase2 } from "./phase2.js";
import { Transcripts, transcriptBody, type Transcribe } from "./speech.js";

type Auth = { id: string; name: string; role: string; device: string };
type Presence = {
  user: string;
  device: string;
  lastSeen: number;
  onDuty: boolean;
  rooms: string[];
  socket: WebSocket;
  expires: number;
};
type Lease = {
  conversation: string;
  user: string;
  device: string;
  message: string;
  expires: number;
  deadline: number;
  leaseId: string;
};
const fail = (code: number, message: string): never => {
  throw Object.assign(new Error(message), { statusCode: code });
};
const identifier = z.string().min(1).max(100);
const messageBody = z.object({
  id: z.string().uuid(),
  text: z.string().trim().max(4000).optional(),
  kind: z.enum(["text", "image", "video", "voice"]).default("text"),
  attachmentId: identifier.optional(),
  createdAt: z.number().int().positive(),
  delayed: z.boolean().default(false),
  transcript: transcriptBody.optional(),
});

export async function buildApp(
  options: {
    dataDir?: string;
    media?: Media;
    adminPassword?: string;
    logger?: boolean;
    transcribe?: Transcribe;
  } = {},
) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 64 * 1024,
  });
  const data = resolve(options.dataDir || process.env.DATA_DIR || "../data");
  mkdirSync(join(data, "files"), { recursive: true });
  const db = new Store(join(data, "kettoo.sqlite"));
  const media = options.media || liveMedia();
  const issuer = new Credentials(data);
  const roomName = (kind: "conversation" | "call", id: string) =>
    `org-${hash(issuer.publicKey)}:${kind}-${id}${kind === "conversation" ? ":v" + (db.get("SELECT value FROM phase_settings WHERE key=?", "media-epoch:" + id)?.value || "1") : ""}`;
  // Recover media permission before declaring a previous transmission ended.
  const recoveryRooms = [
    ...db
      .all(
        "SELECT DISTINCT conversation_id FROM messages WHERE kind='ptt' AND status='live'",
      )
      .map((c) => roomName("conversation", c.conversation_id)),
    ...db
      .all("SELECT id FROM calls WHERE state='accepted'")
      .map((c) => roomName("call", c.id)),
  ];
  try {
    if (recoveryRooms.length && !media.configured)
      throw new Error(
        "Configure media to recover interrupted sessions safely.",
      );
    for (const room of recoveryRooms) await media.close(room);
    db.run(
      "UPDATE calls SET state='ended',ended_at=? WHERE state IN ('ringing','accepted')",
      Date.now(),
    );
    db.run(
      "UPDATE messages SET status='interrupted' WHERE kind='ptt' AND status='live'",
    );
  } catch (error) {
    db.db.close();
    throw error;
  }
  const online = new Map<string, Presence>();
  const leases = new Map<string, Lease>();
  const tickets = new Map<
    string,
    { auth: Auth; expires: number; sessionExpires: number }
  >();
  let chain: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = chain.then(fn, fn);
    chain = result.catch(() => {});
    return result;
  }
  const bootstrap = options.adminPassword || process.env.ADMIN_PASSWORD;
  if (!db.get("SELECT id FROM users WHERE role='admin'")) {
    if (!bootstrap || bootstrap.length < 12)
      throw new Error(
        "Set ADMIN_PASSWORD to at least 12 characters for first startup.",
      );
    const admin = id();
    db.run(
      "INSERT INTO users VALUES(?,?,?,?, 'admin',1)",
      admin,
      "Organisation Admin",
      (process.env.ADMIN_EMAIL || "admin@kettoo.local").toLowerCase(),
      passwordHash(bootstrap),
    );
    db.run("INSERT INTO members VALUES(?,?)", "all-staff", admin);
  }
  await app.register(rateLimit, {
    max: 600,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.ip || "local",
  });
  await app.register(websocket, { options: { maxPayload: 8192 } });
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
  });
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (
      origin &&
      new URL(origin).host !== req.headers.host &&
      origin !== process.env.APP_ORIGIN
    )
      fail(403, "Origin is not allowed");
  });
  app.setErrorHandler((error: any, _req, reply) => {
    const status = error instanceof z.ZodError ? 400 : error.statusCode || 500;
    reply.code(status).send({
      error:
        status >= 500
          ? status === 503
            ? "Media service unavailable"
            : "Request failed"
          : error.message,
    });
  });
  function auth(req: any): Auth {
    const value = req.headers.authorization?.replace(/^Bearer /, "");
    if (!value) return fail(401, "Sign in required");
    const row = db.get(
      `SELECT u.id,u.name,u.role,s.device_id AS device FROM sessions s JOIN users u ON u.id=s.user_id JOIN devices d ON d.id=s.device_id WHERE s.hash=? AND s.expires>? AND u.approved=1 AND d.approved=1`,
      hash(value),
      Date.now(),
    );
    return row || fail(401, "Session expired or approval removed");
  }
  function admin(req: any) {
    const a = auth(req);
    if (a.role !== "admin") fail(403, "Administrator required");
    return a;
  }
  function permitted(user: string, conversation: string) {
    return !!db.get(
      "SELECT 1 FROM members WHERE conversation_id=? AND user_id=?",
      conversation,
      user,
    );
  }
  function conversation(a: Auth, cid: string, publish = false) {
    if (!permitted(a.id, cid)) fail(403, "Conversation access denied");
    const c = db.get("SELECT * FROM conversations WHERE id=?", cid);
    if (publish && c.kind === "broadcast" && a.role !== "admin")
      fail(403, "Only administrators may broadcast");
    return c;
  }
  function event(type: string, payload: any, cid?: string, users?: string[]) {
    const frame = JSON.stringify({ type, payload, at: Date.now() });
    for (const p of online.values())
      if (
        (!cid || permitted(p.user, cid)) &&
        (!users || users.includes(p.user)) &&
        p.socket.readyState === 1
      )
        p.socket.send(frame);
  }
  const busy = (device: string) =>
    db.get(
      "SELECT * FROM calls WHERE state IN ('ringing','accepted') AND (caller_device=? OR callee_device=?)",
      device,
      device,
    );
  function message(mid: string) {
    const m = db.get(
      "SELECT m.*,u.name AS sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=?",
      mid,
    );
    return m
      ? {
          ...m,
          transcript: db.get("SELECT text,state,language,engine,error,updated_at FROM message_transcripts WHERE message_id=?", mid) || null,
          receipts: db.all(
            "SELECT user_id,state,at FROM receipts WHERE message_id=?",
            mid,
          ),
        }
      : null;
  }
  const transcripts = new Transcripts(db, data, mid => {
    const m = message(mid);
    if (m) event("message", m, m.conversation_id);
  }, options.transcribe);
  async function stopLease(cid: string, status = "recording-unavailable") {
    const l = leases.get(cid);
    if (!l) return;
    // Do not free a slot until server-side permission revocation succeeds.
    try {
      await media.publishing(roomName("conversation", cid), l.device, false);
    } catch {
      await media.close(roomName("conversation", cid));
    }
    leases.delete(cid);
    db.run("UPDATE messages SET status=? WHERE id=?", status, l.message);
    event("ptt.ended", { ...l, status }, cid);
    event("message", message(l.message), cid);
  }
  async function endCall(call: any, state: string) {
    if (!["ringing", "accepted"].includes(call.state)) return;
    if (call.state === "accepted") await media.close(roomName("call", call.id));
    db.run(
      "UPDATE calls SET state=?,ended_at=? WHERE id=?",
      state,
      Date.now(),
      call.id,
    );
    event("call", { ...call, state }, undefined, [
      call.caller_id,
      call.callee_id,
    ]);
  }
  async function disconnectDevice(device: string) {
    for (const [cid, l] of leases)
      if (l.device === device) await stopLease(cid, "interrupted");
    const call = busy(device);
    if (call) await endCall(call, "ended");
    const p = online.get(device);
    online.delete(device);
    p?.socket.close(4001, "Session ended");
    for (const c of db.all(
      "SELECT conversation_id FROM members WHERE user_id=(SELECT user_id FROM devices WHERE id=?)",
      device,
    )) {
      try {
        await media.remove(roomName("conversation", c.conversation_id), device);
      } catch {
        /* room may not exist; tokens only grant receive */
      }
    }
  }
  const phase = registerPhase2({
    app,
    db,
    data,
    auth,
    admin,
    serial,
    event,
    presence: () => [...online.values()],
    busy: (device) =>
      busy(device) || [...leases.values()].find((l) => l.device === device),
    uploadsPaused: () =>
      leases.size > 0 ||
      !!db.get("SELECT 1 FROM calls WHERE state='accepted' LIMIT 1"),
    closeChannel: async (cid) => {
      await stopLease(cid, "interrupted");
      await media.close(roomName("conversation", cid));
      const epoch =
        Number(
          db.get(
            "SELECT value FROM phase_settings WHERE key=?",
            "media-epoch:" + cid,
          )?.value || 1,
        ) + 1;
      db.run(
        "INSERT INTO phase_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        "media-epoch:" + cid,
        String(epoch),
      );
      for (const p of online.values())
        p.rooms = p.rooms.filter((x) => x !== cid);
    },
  });
  app.get("/api/health", async () => ({
    ok: true,
    mediaConfigured: media.configured,
    version: "0.1.0",
  }));
  app.post(
    "/api/register",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (req) => {
      const b = z
        .object({
          name: z.string().trim().min(2).max(80),
          email: z.string().email().max(200),
          password: z.string().min(6).max(128),
          deviceName: z.string().min(1).max(80),
          publicKey: z.string().max(4096).optional(),
        })
        .parse(req.body);
      if (db.get("SELECT id FROM users WHERE email=?", b.email.toLowerCase()))
        fail(409, "Account already exists");
      const uid = id(),
        did = id();
      db.transaction(() => {
        db.run(
          "INSERT INTO users VALUES(?,?,?,?, 'staff',0)",
          uid,
          b.name,
          b.email.toLowerCase(),
          passwordHash(b.password),
        );
        db.run(
          "INSERT INTO devices(id,user_id,name,public_key,approved) VALUES(?,?,?,?,0)",
          did,
          uid,
          b.deviceName,
          b.publicKey || null,
        );
      });
      return {
        userId: uid,
        deviceId: did,
        status: "Awaiting administrator approval",
      };
    },
  );
  app.post(
    "/api/login",
    { config: { rateLimit: { max: 15, timeWindow: "5 minutes" } } },
    async (req) => {
      const b = z
        .object({
          email: z.string().email(),
          password: z.string().max(128),
          deviceId: identifier.optional(),
          deviceName: z.string().max(80).default("Browser"),
          publicKey: z.string().max(4096).optional(),
        })
        .parse(req.body);
      const u = db.get(
        "SELECT * FROM users WHERE email=?",
        b.email.toLowerCase(),
      );
      if (!u || !passwordMatches(b.password, u.password))
        fail(401, "Incorrect email or password");
      if (!u.approved) fail(403, "Account awaits administrator approval");
      let d = b.deviceId
        ? db.get(
            "SELECT * FROM devices WHERE id=? AND user_id=?",
            b.deviceId,
            u.id,
          )
        : null;
      if (b.deviceId && !d) fail(403, "Unknown device");
      if (!d) {
        const did = id();
        // Only the first administrator device is bootstrapped. Further devices need approval.
        const initial =
          u.role === "admin" &&
          !db.get("SELECT id FROM devices WHERE user_id=?", u.id);
        db.run(
          "INSERT INTO devices(id,user_id,name,public_key,approved) VALUES(?,?,?,?,?)",
          did,
          u.id,
          b.deviceName,
          b.publicKey || null,
          initial ? 1 : 0,
        );
        d = db.get("SELECT * FROM devices WHERE id=?", did);
      }
      if (!d.approved) return { deviceId: d.id, pending: true };
      const access = token();
      db.run(
        "INSERT INTO sessions VALUES(?,?,?,?)",
        hash(access),
        u.id,
        d.id,
        Date.now() + 12 * 3600_000,
      );
      return {
        token: access,
        deviceId: d.id,
        user: { id: u.id, name: u.name, role: u.role },
      };
    },
  );
  app.post("/api/logout", async (req) => {
    const a = auth(req);
    db.run(
      "DELETE FROM sessions WHERE hash=?",
      hash(req.headers.authorization!.slice(7)),
    );
    await serial(() => disconnectDevice(a.device));
    return { ok: true };
  });
  app.get("/api/me", async (req) => auth(req));
  app.get("/api/people", async (req) => {
    auth(req);
    return db.all("SELECT id,name,role FROM users WHERE approved=1");
  });
  app.get("/api/conversations", async (req) => {
    const a = auth(req);
    return db
      .all(
        "SELECT c.* FROM conversations c JOIN members m ON m.conversation_id=c.id WHERE m.user_id=? ORDER BY c.kind,c.name",
        a.id,
      )
      .map((c) => ({
        ...c,
        pttAllowed: phase.pttAllowed(a, c),
        mediaAllowed: phase.permittedMedia(a, c),
        mediaEpoch:
          db.get(
            "SELECT value FROM phase_settings WHERE key=?",
            "media-epoch:" + c.id,
          )?.value || "1",
        priority: c.kind === "broadcast" ? 10 : 0,
        members: db.all(
          "SELECT u.id,u.name FROM users u JOIN members m ON m.user_id=u.id WHERE m.conversation_id=?",
          c.id,
        ),
        speaker: leases.has(c.id)
          ? {
              ...leases.get(c.id),
              leaseId: undefined,
              speakerName: db.get(
                "SELECT name FROM users WHERE id=?",
                leases.get(c.id)!.user,
              )?.name,
              priority: c.kind === "broadcast" ? 10 : 0,
            }
          : null,
        listeners: [...online.values()].filter(
          (p) =>
            p.onDuty &&
            p.rooms.includes(c.id) &&
            Date.now() - p.lastSeen < 30000,
        ).length,
      }));
  });
  app.post("/api/private", async (req) => {
    const a = auth(req),
      b = z.object({ userId: identifier }).parse(req.body);
    const other = db.get(
      "SELECT id,name FROM users WHERE id=? AND approved=1",
      b.userId,
    );
    if (!other || other.id === a.id)
      fail(400, "Choose another approved member");
    const pair = [a.id, other.id].sort().join(":");
    const previous = db.get("SELECT * FROM conversations WHERE pair=?", pair);
    if (previous) return previous;
    const cid = id();
    db.transaction(() => {
      db.run(
        "INSERT INTO conversations VALUES(?,?,'private',?)",
        cid,
        `${a.name} · ${other.name}`,
        pair,
      );
      db.run("INSERT INTO members VALUES(?,?)", cid, a.id);
      db.run("INSERT INTO members VALUES(?,?)", cid, other.id);
    });
    event("permissions", {}, cid);
    return db.get("SELECT * FROM conversations WHERE id=?", cid);
  });
  app.get("/api/conversations/:cid/messages", async (req) => {
    const a = auth(req),
      { cid } = req.params as any;
    conversation(a, cid);
    const q = z
      .object({
        after: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(200).default(100),
        folder: z.enum(["all", "active", "archived"]).default("all"),
      })
      .parse(req.query);
    const rows = db.all(
      "SELECT id FROM messages WHERE conversation_id=? AND seq>? AND (?='all' OR (?='archived')=EXISTS(SELECT 1 FROM receipts r WHERE r.message_id=messages.id AND r.user_id=? AND r.state='acknowledged')) ORDER BY seq LIMIT ?",
      cid,
      q.after,
      q.folder,
      q.folder,
      a.id,
      q.limit,
    );
    return {
      messages: rows.map((r) => message(r.id)),
      hasMore: rows.length === q.limit,
    };
  });
  function storeMessage(
    a: Auth,
    cid: string,
    b: z.infer<typeof messageBody>,
    fileUploader = a.id,
    peerPtt = false,
  ) {
    conversation(a, cid, true);
    const old = message(b.id);
    if (old) {
      if (old.sender_id !== a.id || old.conversation_id !== cid)
        fail(409, "Message ID already used");
      return old;
    }
    if (b.createdAt > Date.now() + 60_000)
      fail(400, "Creation time is in the future");
    if (b.kind === "text" && !b.text) fail(400, "Message is empty");
    if (b.transcript && b.kind !== "voice") fail(400, "Transcript requires an audio message");
    if (b.kind !== "text") {
      const file = db.get(
        "SELECT * FROM files WHERE id=? AND conversation_id=? AND uploader_id=?",
        b.attachmentId || "",
        cid,
        fileUploader,
      );
      if (
        !file ||
        !file.mime.startsWith(
          ({ image: "image/", video: "video/", voice: "audio/" } as any)[
            b.kind
          ],
        )
      )
        fail(400, "A matching completed upload is required");
    }
    db.run(
      "INSERT INTO messages(id,conversation_id,sender_id,device_id,kind,text,attachment_id,created_at,received_at,delayed) VALUES(?,?,?,?,?,?,?,?,?,?)",
      b.id,
      cid,
      a.id,
      a.device,
      peerPtt ? "ptt" : b.kind,
      b.text || null,
      b.attachmentId || null,
      b.createdAt,
      Date.now(),
      b.delayed || Date.now() - b.createdAt > 30000 ? 1 : 0,
    );
    if (b.kind === "voice") transcripts.attach(b.id, b.attachmentId!, b.transcript);
    event("message", message(b.id), cid);
    return message(b.id);
  }
  app.post("/api/conversations/:cid/messages", async (req) =>
    storeMessage(
      auth(req),
      (req.params as any).cid,
      messageBody.parse(req.body),
    ),
  );
  app.post("/api/messages/:mid/receipt", async (req) => {
    const a = auth(req),
      m = message((req.params as any).mid);
    if (!m) fail(404, "Message not found");
    conversation(a, m.conversation_id);
    const { state } = z
      .object({ state: z.enum(["received", "acknowledged"]) })
      .parse(req.body);
    db.run(
      "INSERT INTO receipts VALUES(?,?,?,?) ON CONFLICT(message_id,user_id) DO UPDATE SET state=CASE WHEN receipts.state='acknowledged' THEN receipts.state ELSE excluded.state END,at=excluded.at",
      m.id,
      a.id,
      state,
      Date.now(),
    );
    event("message", message(m.id), m.conversation_id);
    return { ok: true };
  });
  app.post("/api/messages/:mid/transcript/retry", async req => {
    const a = auth(req), m = message((req.params as any).mid);
    if (!m) fail(404, "Message not found");
    conversation(a, m.conversation_id);
    if (!['voice', 'ptt'].includes(m.kind) || !m.attachment_id) fail(400, "Audio recording required");
    transcripts.retry(m.id, m.attachment_id);
    return message(m.id);
  });
  app.post("/api/conversations/:cid/files", async (req) => {
    const a = auth(req),
      { cid } = req.params as any;
    conversation(a, cid, true);
    if (leases.size || busy(a.device))
      fail(409, "Uploads pause during live communication");
    const part = await req.file();
    if (!part) fail(400, "File required");
    const mime = part!.mimetype;
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "video/mp4",
      "video/webm",
      "audio/mp4",
      "audio/m4a",
      "audio/webm",
      "audio/ogg",
      "audio/wav",
    ];
    if (!allowed.includes(mime)) fail(415, "Unsupported attachment format");
    const buffer = await part!.toBuffer();
    const cap = mime.startsWith("image/")
      ? 5 * 1024 * 1024
      : mime.startsWith("audio/")
        ? 1024 * 1024
        : 10 * 1024 * 1024;
    if (!buffer.length || buffer.length > cap)
      fail(413, "Attachment exceeds its size limit");
    // Check common container signatures; downloads are always non-executable and nosniff.
    const valid =
      mime === "image/jpeg"
        ? buffer[0] === 255 && buffer[1] === 216
        : mime === "image/png"
          ? buffer
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : mime === "image/webp" || mime === "audio/wav"
            ? buffer.toString("ascii", 0, 4) === "RIFF"
            : mime.endsWith("webm")
              ? buffer.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))
              : mime === "audio/ogg"
                ? buffer.toString("ascii", 0, 4) === "OggS"
                : buffer.toString("ascii", 4, 8) === "ftyp";
    if (!valid) fail(415, "File contents do not match the declared format");
    const digest = hash(buffer);
    const previous = db.get(
      "SELECT * FROM files WHERE conversation_id=? AND uploader_id=? AND sha256=? AND mime=? AND size=?",
      cid,
      a.id,
      digest,
      mime,
      buffer.length,
    );
    if (previous) return previous;
    const fid = id(),
      path = join(data, "files", fid);
    await writeFile(path + ".partial", buffer);
    await rename(path + ".partial", path);
    try {
      db.run(
        "INSERT INTO files VALUES(?,?,?,?,?,?,?)",
        fid,
        cid,
        a.id,
        part!.filename.slice(0, 160),
        mime,
        buffer.length,
        digest,
      );
    } catch (e) {
      await unlink(path);
      throw e;
    }
    return db.get("SELECT * FROM files WHERE id=?", fid);
  });
  app.get("/api/files/:fid", async (req, reply) => {
    const a = auth(req),
      f = db.get("SELECT * FROM files WHERE id=?", (req.params as any).fid);
    if (!f) fail(404, "File not found");
    conversation(a, f.conversation_id);
    reply
      .type(f.mime)
      .header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      );
    return reply.send(createReadStream(join(data, "files", f.id)));
  });
  app.post("/api/ws-ticket", async (req) => {
    const a = auth(req),
      value = token();
    const session = db.get(
      "SELECT expires FROM sessions WHERE hash=?",
      hash(req.headers.authorization!.slice(7)),
    );
    tickets.set(value, {
      auth: a,
      expires: Date.now() + 15000,
      sessionExpires: session.expires,
    });
    return { ticket: value };
  });
  app.get("/api/events", { websocket: true }, (socket, req) => {
    const key = (req.query as any).ticket,
      t = tickets.get(key);
    tickets.delete(key);
    if (
      !t ||
      t.expires < Date.now() ||
      !db.get(
        "SELECT 1 FROM devices d JOIN users u ON u.id=d.user_id WHERE d.id=? AND d.approved=1 AND u.approved=1",
        t.auth.device,
      )
    ) {
      socket.close(4001, "Invalid ticket");
      return;
    }
    online.get(t.auth.device)?.socket.close(4000, "New connection");
    const p: Presence = {
      user: t.auth.id,
      device: t.auth.device,
      lastSeen: Date.now(),
      onDuty: false,
      rooms: [],
      socket,
      expires: t.sessionExpires,
    };
    online.set(p.device, p);
    socket.on("message", (frame) => {
      try {
        const b = z
          .object({
            type: z.literal("heartbeat"),
            onDuty: z.boolean(),
            rooms: z.array(identifier).max(100),
          })
          .parse(JSON.parse(frame.toString()));
        p.lastSeen = Date.now();
        db.run(
          "UPDATE devices SET last_seen=? WHERE id=?",
          p.lastSeen,
          p.device,
        );
        p.onDuty = b.onDuty;
        p.rooms = b.onDuty ? b.rooms.filter((c) => permitted(p.user, c)) : [];
        socket.send(
          JSON.stringify({ type: "heartbeat", payload: { at: Date.now() } }),
        );
      } catch {
        socket.close(4002, "Invalid heartbeat");
      }
    });
    socket.on("close", () => {
      if (online.get(p.device) === p) {
        online.delete(p.device);
        void serial(async () => {
          for (const [cid, l] of leases)
            if (l.device === p.device) await stopLease(cid, "interrupted");
          const c = busy(p.device);
          if (c) await endCall(c, "ended");
        }).catch(() => {});
      }
    });
    socket.send(JSON.stringify({ type: "connected", payload: {} }));
  });
  app.post("/api/conversations/:cid/media-token", async (req) => {
    const a = auth(req),
      { cid } = req.params as any;
    conversation(a, cid);
    const conv = db.get("SELECT * FROM conversations WHERE id=?", cid);
    if (!phase.permittedMedia(a, conv))
      fail(403, "Live PTT receive access denied");
    if (!online.get(a.device)?.onDuty)
      fail(409, "Start an on-duty session first");
    return {
      url: media.url,
      room: roomName("conversation", cid),
      token: await media.token(roomName("conversation", cid), a.device, a.name),
    };
  });
  app.post("/api/conversations/:cid/ptt", async (req) =>
    serial(async () => {
      const a = auth(req),
        { cid } = req.params as any,
        c = conversation(a, cid, true);
      phase.assertPtt(a, c);
      const p = online.get(a.device);
      if (
        !p?.onDuty ||
        !p.rooms.includes(cid) ||
        Date.now() - p.lastSeen > 30000
      )
        fail(409, "Receive media must be connected before transmitting");
      if (busy(a.device)) fail(409, "Device is in a call");
      if ([...leases.values()].some((l) => l.device === a.device))
        fail(409, "Microphone is already in use");
      const audienceUsers = db
        .all(
          "SELECT m.user_id FROM members m JOIN users u ON u.id=m.user_id WHERE m.conversation_id=? AND u.role='staff'",
          cid,
        )
        .map((x) => x.user_id);
      if (
        leases.has(cid) ||
        [...leases.keys()].some(
          (k) =>
            k !== cid &&
            db.get("SELECT kind FROM conversations WHERE id=?", k)?.kind ===
              "broadcast" &&
            db
              .all("SELECT user_id FROM members WHERE conversation_id=?", k)
              .some((x) => audienceUsers.includes(x.user_id)),
        )
      )
        fail(409, "Channel is busy");
      if (c.kind === "broadcast")
        for (const other of [...leases.keys()])
          if (
            db
              .all("SELECT user_id FROM members WHERE conversation_id=?", other)
              .some((x) => audienceUsers.includes(x.user_id))
          )
            await stopLease(other, "interrupted");
      phase.activeBroadcast(cid);
      await media.publishing(roomName("conversation", cid), a.device, true);
      const mid = id(),
        now = Date.now();
      const l: Lease = {
        conversation: cid,
        user: a.id,
        device: a.device,
        message: mid,
        expires: now + 6000,
        deadline: now + 30000,
        leaseId: token(),
      };
      leases.set(cid, l);
      db.run(
        "INSERT INTO messages(id,conversation_id,sender_id,device_id,kind,created_at,received_at,status) VALUES(?,?,?,?,'ptt',?,?,'live')",
        mid,
        cid,
        a.id,
        a.device,
        now,
        now,
      );
      const audience = db
        .all(
          "SELECT user_id FROM members WHERE conversation_id=? AND user_id!=?",
          cid,
          a.id,
        )
        .map((r) => {
          const devices = [...online.values()].filter(
            (x) => x.user === r.user_id && Date.now() - x.lastSeen < 30000,
          );
          return {
            userId: r.user_id,
            state: !devices.length
              ? "offline"
              : devices.some((x) => busy(x.device))
                ? "busy"
                : devices.some((x) => x.onDuty && x.rooms.includes(cid))
                  ? "media-connected"
                  : "unavailable",
          };
        });
      event(
        "ptt.started",
        {
          ...l,
          leaseId: undefined,
          speakerName: a.name,
          audience,
          priority: c.kind === "broadcast" ? 10 : 0,
        },
        cid,
      );
      event("message", message(mid), cid);
      return { ...l, audience };
    }),
  );
  app.post("/api/conversations/:cid/ptt/:action", async (req) =>
    serial(async () => {
      const a = auth(req),
        { cid, action } = req.params as any;
      conversation(a, cid, true);
      phase.assertPtt(a, db.get("SELECT * FROM conversations WHERE id=?", cid));
      const b = z.object({ leaseId: z.string() }).parse(req.body),
        l = leases.get(cid);
      if (!l || l.device !== a.device || l.leaseId !== b.leaseId)
        fail(409, "Speaking lease is no longer active");
      if (action === "release") {
        await stopLease(cid);
        return { ok: true };
      }
      if (action !== "renew") fail(404, "Unknown action");
      if (Date.now() >= l!.expires || Date.now() >= l!.deadline) {
        await stopLease(cid, "interrupted");
        fail(409, "Speaking lease expired");
      }
      if (!online.get(a.device)?.onDuty) {
        await stopLease(cid, "interrupted");
        fail(409, "On-duty session ended");
      }
      l!.expires = Math.min(Date.now() + 6000, l!.deadline);
      return { expires: l!.expires };
    }),
  );
  app.post("/api/messages/:mid/recording", async (req) => {
    const a = auth(req),
      m = message((req.params as any).mid),
      b = z.object({ attachmentId: identifier, transcript: transcriptBody.optional() }).parse(req.body);
    if (!m || m.sender_id !== a.id || m.kind !== "ptt" || m.status === "live")
      fail(403, "Completed own PTT message required");
    conversation(a, m.conversation_id, true);
    const f = db.get(
      "SELECT * FROM files WHERE id=? AND uploader_id=? AND conversation_id=?",
      b.attachmentId,
      a.id,
      m.conversation_id,
    );
    if (!f?.mime.startsWith("audio/")) fail(400, "Audio upload required");
    db.run(
      "UPDATE messages SET attachment_id=?,status=CASE WHEN status='interrupted' THEN 'interrupted-recorded' ELSE 'recorded' END WHERE id=?",
      f.id,
      m.id,
    );
    transcripts.attach(m.id, f.id, b.transcript);
    event("message", message(m.id), m.conversation_id);
    return message(m.id);
  });
  app.post("/api/calls", async (req) =>
    serial(async () => {
      const a = auth(req),
        b = z
          .object({
            conversationId: identifier,
            video: z.boolean().default(false),
          })
          .parse(req.body),
        c = conversation(a, b.conversationId);
      if (c.kind !== "private")
        fail(400, "Calls require a private conversation");
      if (busy(a.device)) fail(409, "Device is busy");
      if (phase.exchangeBusy(a.device))
        fail(409, "Finish the admin exchange first");
      const callee = db.get(
        "SELECT user_id FROM members WHERE conversation_id=? AND user_id!=?",
        c.id,
        a.id,
      ).user_id;
      const devices = [...online.values()].filter(
        (p) => p.user === callee && p.onDuty && Date.now() - p.lastSeen < 30000,
      );
      if (!devices.length) fail(409, "Recipient is unavailable");
      const target = devices.find(
        (p) => !busy(p.device) && !phase.exchangeBusy(p.device),
      );
      if (!target) fail(409, "Recipient is busy");
      const callId = id();
      db.run(
        "INSERT INTO calls VALUES(?,?,?,?,?,?,?,'ringing',?,NULL)",
        callId,
        c.id,
        a.id,
        callee,
        a.device,
        target!.device,
        b.video ? 1 : 0,
        Date.now(),
      );
      const call = db.get("SELECT * FROM calls WHERE id=?", callId);
      event("call", call, undefined, [a.id, callee]);
      return call;
    }),
  );
  app.get("/api/calls/active", async (req) => {
    const a = auth(req);
    return busy(a.device) || null;
  });
  app.post("/api/calls/:callId/:action", async (req) =>
    serial(async () => {
      const a = auth(req),
        { callId, action } = req.params as any,
        c = db.get("SELECT * FROM calls WHERE id=?", callId);
      if (!c || ![c.caller_device, c.callee_device].includes(a.device))
        fail(403, "Call access denied");
      conversation(a, c.conversation_id);
      if (action === "token") {
        if (c.state !== "accepted") fail(409, "Call is not accepted");
        return {
          url: media.url,
          token: await media.token(
            roomName("call", c.id),
            a.device,
            a.name,
            true,
          ),
        };
      }
      if (action === "accept") {
        if (c.state !== "ringing" || a.device !== c.callee_device)
          fail(409, "Only the ringing recipient can accept");
        if (!media.configured) fail(503, "Media server unavailable");
        for (const [cid, l] of leases)
          if ([c.caller_device, c.callee_device].includes(l.device))
            await stopLease(cid, "interrupted");
        db.run("UPDATE calls SET state='accepted' WHERE id=?", c.id);
        c.state = "accepted";
        event("call", c, undefined, [c.caller_id, c.callee_id]);
        return c;
      }
      if (!["decline", "end"].includes(action)) fail(404, "Unknown action");
      if (
        action === "decline" &&
        (a.device !== c.callee_device || c.state !== "ringing")
      )
        fail(409, "Only the ringing recipient may decline");
      await endCall(c, action === "decline" ? "declined" : "ended");
      return { ok: true };
    }),
  );
  app.get("/api/admin/overview", async (req) => {
    admin(req);
    return {
      users: db
        .all("SELECT id,name,email,role,approved FROM users")
        .map((u) => ({
          ...u,
          devices: db
            .all(
              "SELECT id,name,approved,last_seen FROM devices WHERE user_id=?",
              u.id,
            )
            .map((d) => {
              const p = online.get(d.id);
              return {
                ...d,
                online: !!p && Date.now() - p.lastSeen < 30000,
                onDuty: p?.onDuty || false,
                rooms: p?.rooms || [],
                exchangeBusy: !!phase.exchangeBusy(d.id),
                lastSeen: p?.lastSeen || d.last_seen || null,
                busy: !!busy(d.id),
              };
            }),
        })),
      channels: db
        .all("SELECT * FROM conversations WHERE kind!='private'")
        .map((c) => ({
          ...c,
          memberIds: db
            .all("SELECT user_id FROM members WHERE conversation_id=?", c.id)
            .map((x) => x.user_id),
          speaker: leases.get(c.id)?.user || null,
          listeners: [...online.values()].filter(
            (p) =>
              p.onDuty &&
              p.rooms.includes(c.id) &&
              Date.now() - p.lastSeen < 30000,
          ).length,
        })),
      teams: db.all("SELECT * FROM teams").map((t) => ({
        ...t,
        memberIds: db
          .all("SELECT user_id FROM team_members WHERE team_id=?", t.id)
          .map((x) => x.user_id),
      })),
      mediaConfigured: media.configured,
    };
  });
  app.post("/api/admin/users/:uid/approval", async (req) =>
    serial(async () => {
      const a = admin(req),
        { uid } = req.params as any,
        b = z.object({ approved: z.boolean() }).parse(req.body);
      if (uid === a.id) fail(400, "Cannot revoke your own account");
      const u = db.get("SELECT * FROM users WHERE id=?", uid);
      if (!u) fail(404, "User not found");
      db.run("UPDATE users SET approved=? WHERE id=?", b.approved ? 1 : 0, uid);
      if (b.approved)
        db.run("INSERT OR IGNORE INTO members VALUES(?,?)", "all-staff", uid);
      else {
        await phase.invalidateBroadcasts(uid);
        db.run("DELETE FROM sessions WHERE user_id=?", uid);
        for (const d of db.all("SELECT id FROM devices WHERE user_id=?", uid))
          await disconnectDevice(d.id);
      }
      db.audit(a.id, b.approved ? "approve-user" : "revoke-user", uid);
      event("permissions", {}, undefined, [uid]);
      return { ok: true };
    }),
  );
  app.post("/api/admin/devices/:did/approval", async (req) =>
    serial(async () => {
      const a = admin(req),
        { did } = req.params as any,
        b = z.object({ approved: z.boolean() }).parse(req.body);
      if (did === a.device && !b.approved)
        fail(400, "Cannot revoke your current device");
      if (!db.get("SELECT id FROM devices WHERE id=?", did))
        fail(404, "Device not found");
      db.run(
        "UPDATE devices SET approved=? WHERE id=?",
        b.approved ? 1 : 0,
        did,
      );
      if (!b.approved) {
        db.run("DELETE FROM sessions WHERE device_id=?", did);
        await disconnectDevice(did);
      }
      db.audit(a.id, b.approved ? "approve-device" : "revoke-device", did);
      return { ok: true };
    }),
  );
  app.post("/api/admin/channels", async (req) => {
    const a = admin(req),
      b = z.object({ name: z.string().trim().min(2).max(80) }).parse(req.body),
      cid = id();
    db.run("INSERT INTO conversations VALUES(?,?,'channel',NULL)", cid, b.name);
    db.run("INSERT INTO members VALUES(?,?)", cid, a.id);
    db.audit(a.id, "create-channel", cid);
    event("permissions", {});
    return { id: cid };
  });
  app.put("/api/admin/channels/:cid/members", async (req) =>
    serial(async () => {
      const a = admin(req),
        { cid } = req.params as any,
        b = z
          .object({ memberIds: z.array(identifier).max(1000) })
          .parse(req.body),
        c = db.get("SELECT * FROM conversations WHERE id=?", cid);
      if (!c || c.kind !== "channel")
        fail(400, "Only channel memberships can be edited");
      if (db.get("SELECT 1 FROM operational_teams WHERE channel_id=?", cid))
        fail(409, "Use operational assignments for this team");
      for (const uid of b.memberIds)
        if (!db.get("SELECT id FROM users WHERE id=? AND approved=1", uid))
          fail(400, "Members must be approved");
      const removed = db
        .all("SELECT user_id FROM members WHERE conversation_id=?", cid)
        .map((x) => x.user_id)
        .filter((x) => !b.memberIds.includes(x));
      if (leases.has(cid) && removed.includes(leases.get(cid)!.user))
        await stopLease(cid, "interrupted");
      for (const uid of removed) await phase.invalidateBroadcasts(uid);
      for (const uid of removed)
        for (const d of db.all("SELECT id FROM devices WHERE user_id=?", uid)) {
          try {
            await media.remove(roomName("conversation", cid), d.id);
          } catch {
            /* room may be absent */
          }
        }
      db.transaction(() => {
        db.run("DELETE FROM members WHERE conversation_id=?", cid);
        for (const uid of new Set(b.memberIds))
          db.run("INSERT INTO members VALUES(?,?)", cid, uid);
      });
      for (const p of online.values())
        p.rooms = p.rooms.filter((x) => permitted(p.user, x));
      db.audit(a.id, "set-channel-members", cid);
      event("permissions", {});
      return { ok: true };
    }),
  );
  app.post("/api/admin/teams", async (req) => {
    const a = admin(req),
      b = z.object({ name: z.string().trim().min(2).max(80) }).parse(req.body),
      tid = id();
    if (db.get("SELECT id FROM teams WHERE name=?", b.name))
      fail(409, "Team already exists");
    db.run("INSERT INTO teams VALUES(?,?)", tid, b.name);
    db.audit(a.id, "create-team", tid);
    return { id: tid };
  });
  app.put("/api/admin/teams/:tid/members", async (req) => {
    const a = admin(req),
      { tid } = req.params as any,
      b = z
        .object({ memberIds: z.array(identifier).max(1000) })
        .parse(req.body);
    if (!db.get("SELECT id FROM teams WHERE id=?", tid))
      fail(404, "Team not found");
    for (const uid of b.memberIds)
      if (!db.get("SELECT id FROM users WHERE id=? AND approved=1", uid))
        fail(400, "Members must be approved");
    db.transaction(() => {
      db.run("DELETE FROM team_members WHERE team_id=?", tid);
      for (const uid of new Set(b.memberIds))
        db.run("INSERT INTO team_members VALUES(?,?)", tid, uid);
    });
    db.audit(a.id, "set-team-members", tid);
    return { ok: true };
  });
  app.post("/api/offline/credential", async (req) => {
    const a = auth(req),
      d = db.get("SELECT * FROM devices WHERE id=?", a.device);
    if (!d.public_key) fail(409, "Enrol a device public key first");
    const payload = {
      org: hash(issuer.publicKey),
      user: a.id,
      device: a.device,
      publicKey: d.public_key,
      name: a.name,
      // Live rights are distinct from private text/call membership. Sign room
      // epochs and session expiry so peers cannot invent or extend live access.
      liveConversations: db.all("SELECT c.* FROM conversations c JOIN members m ON m.conversation_id=c.id WHERE m.user_id=?", a.id)
        .filter(c => phase.permittedMedia(a, c))
        .map(c => {
          const broadcast = db.get("SELECT expires_at FROM broadcast_sessions WHERE conversation_id=?", c.id);
          const exchange = c.kind === "private" ? phase.exchange() : undefined;
          return {
            id: c.id,
            epoch: String(db.get("SELECT value FROM phase_settings WHERE key=?", "media-epoch:" + c.id)?.value || "1"),
            canPublish: phase.pttAllowed(a, c),
            priority: c.kind === "broadcast" ? 10 : 0,
            expiresAt: Math.min(Date.now() + 8 * 3600_000, broadcast?.expires_at || Infinity,
              exchange?.conversation_id === c.id ? exchange.expires_at : Infinity),
          };
        }),
      publishConversations: db
        .all(
          "SELECT m.conversation_id FROM members m JOIN conversations c ON c.id=m.conversation_id WHERE m.user_id=? AND (c.kind!='broadcast' OR ?='admin')",
          a.id,
          a.role,
        )
        .map((c) => c.conversation_id),
      conversations: db
        .all("SELECT conversation_id FROM members WHERE user_id=?", a.id)
        .map((c) => c.conversation_id),
      expiresAt: Date.now() + 8 * 3600_000,
    };
    return {
      credential: issuer.issue(payload),
      issuerPublicKey: issuer.publicKey,
      expiresAt: payload.expiresAt,
    };
  });
  app.post("/api/offline/sync", async (req) => {
    const a = auth(req),
      b = z
        .object({
          credential: z.string().max(12000),
          envelope: z.string().max(16000),
          signature: z.string().max(2000),
          attachmentId: identifier.optional(),
          transcript: transcriptBody.optional(),
        })
        .parse(req.body);
    let credential: any, envelope: any;
    try {
      credential = issuer.verify(b.credential);
      const key =
        "-----BEGIN PUBLIC KEY-----\n" +
        credential.publicKey +
        "\n-----END PUBLIC KEY-----";
      if (
        !verify(
          "SHA256",
          Buffer.from(b.envelope),
          key,
          Buffer.from(b.signature, "base64"),
        )
      )
        fail(403, "Invalid message signature");
      envelope = JSON.parse(b.envelope);
    } catch {
      fail(403, "Invalid or expired peer credential");
    }
    const cid = identifier.parse(envelope.conversationId);
    conversation(a, cid);
    if (
      !credential.conversations.includes(cid) ||
      !permitted(credential.user, cid) ||
      !db.get(
        "SELECT 1 FROM devices d JOIN users u ON u.id=d.user_id WHERE d.id=? AND d.user_id=? AND d.approved=1 AND u.approved=1",
        credential.device,
        credential.user,
      )
    )
      fail(403, "Sender no longer authorized");
    const sender = db.get(
      "SELECT id,name,role FROM users WHERE id=?",
      credential.user,
    );
    if (!["text", "voice", "ptt", "image", "video"].includes(envelope.kind))
      fail(400, "Unsupported Nearby message type");
    const peerPtt = envelope.kind === "ptt";
    if (peerPtt) {
      const grant = credential.liveConversations?.find((c: any) => c.id === cid && c.canPublish);
      const epoch = String(db.get("SELECT value FROM phase_settings WHERE key=?", "media-epoch:" + cid)?.value || "1");
      if (!grant || grant.epoch !== epoch || envelope.createdAt > grant.expiresAt ||
        !phase.pttAllowed({ ...sender, device: credential.device }, db.get("SELECT * FROM conversations WHERE id=?", cid)))
        fail(403, "Nearby live audio permission changed or expired");
    }
    if (envelope.kind !== "text") {
      const f = db.get(
        "SELECT * FROM files WHERE id=? AND conversation_id=? AND uploader_id=?",
        b.attachmentId || "",
        cid,
        a.id,
      );
      if (
        !f ||
        !f.mime.startsWith(({voice:"audio/",ptt:"audio/",image:"image/",video:"video/"} as any)[envelope.kind]) ||
        f.sha256 !== envelope.sha256 ||
        f.size !== envelope.size
      )
        fail(400, "Attachment does not match the signed peer message");
    }
    const parsed = messageBody.parse({
      ...envelope,
      kind: peerPtt ? "voice" : envelope.kind,
      transcript: b.transcript,
      attachmentId: b.attachmentId,
      delayed: true,
    });
    const m = storeMessage(
      { ...sender, device: credential.device },
      cid,
      parsed,
      a.id,
      peerPtt,
    );
    if (a.id !== sender.id) {
      db.run(
        "INSERT INTO receipts VALUES(?,?,'received',?) ON CONFLICT(message_id,user_id) DO NOTHING",
        m.id,
        a.id,
        Date.now(),
      );
      event("message", message(m.id), cid);
    }
    return message(m.id);
  });
  const timer = setInterval(() => {
    void transcripts.tick(leases.size > 0 || !!db.get("SELECT 1 FROM calls WHERE state='accepted'"));
    void serial(async () => {
      const now = Date.now();
      await phase.expire();
      for (const [key, t] of tickets) if (t.expires < now) tickets.delete(key);
      for (const [cid, l] of leases)
        if (now >= l.expires) await stopLease(cid, "interrupted");
      for (const p of online.values())
        if (now - p.lastSeen > 30000 || now > p.expires)
          await disconnectDevice(p.device);
      for (const c of db.all(
        "SELECT * FROM calls WHERE state='ringing' AND created_at<?",
        now - 30000,
      ))
        await endCall(c, "missed");
    }).catch(() => {
      /* fail closed: occupied lease remains blocked until revocation succeeds */
    });
  }, 1000);
  timer.unref();
  const web = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../web/dist",
  );
  if (existsSync(web)) {
    await app.register(staticFiles, { root: web });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.code(404).send({ error: "Not found" })
        : reply.sendFile("index.html"),
    );
  }
  app.addHook("onClose", async () => {
    clearInterval(timer);
    const sockets = [...online.values()].map((p) => p.socket);
    online.clear();
    sockets.forEach((socket) => socket.close());
    await serial(async () => {
      for (const cid of [...leases.keys()]) await stopLease(cid, "interrupted");
      for (const call of db.all(
        "SELECT * FROM calls WHERE state IN ('ringing','accepted')",
      ))
        await endCall(call, "ended");
    });
    await chain;
    await transcripts.close();
    db.db.close();
  });
  return app;
}
