import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createReadStream } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { Store, id } from "./db.js";
import { hash } from "./security.js";

type Auth = { id: string; name: string; role: string; device: string };
type Context = {
  app: FastifyInstance;
  db: Store;
  data: string;
  auth: (req: any) => Auth;
  admin: (req: any) => Auth;
  serial: <T>(fn: () => Promise<T>) => Promise<T>;
  event: (type: string, payload: any, cid?: string, users?: string[]) => void;
  presence: () => any[];
  busy: (device: string) => any;
  uploadsPaused: () => boolean;
  closeChannel: (cid: string) => Promise<void>;
};
const key = z.string().min(1).max(100);
const uuid = z.string().uuid();
const bad = (code: number, message: string): never => {
  throw Object.assign(new Error(message), { statusCode: code });
};

export function registerPhase2(c: Context) {
  const { app, db, auth, admin, serial } = c;
  const team = (uid: string) =>
    db.get(
      "SELECT t.*,o.channel_id,o.media_epoch FROM operational_assignments a JOIN teams t ON t.id=a.team_id JOIN operational_teams o ON o.team_id=t.id WHERE a.user_id=?",
      uid,
    );
  const duty = () =>
    JSON.parse(
      db.get("SELECT value FROM phase_settings WHERE key='duty-admin'")
        ?.value || "null",
    );
  const exchange = () =>
    db.get(
      "SELECT * FROM admin_exchanges WHERE state='open' AND expires_at>? LIMIT 1",
      Date.now(),
    );
  const visible = (a: Auth, issue: any) =>
    !!issue &&
    (a.role === "admin" ||
      issue.audience === "everyone" ||
      team(a.id)?.id === issue.team_id);
  const issue = (a: Auth, iid: string) => {
    const x = db.get("SELECT * FROM issues WHERE id=?", iid);
    if (!visible(a, x)) bad(404, "Thread unavailable");
    return x;
  };
  const viewers = (x: any) =>
    db
      .all("SELECT id,role FROM users WHERE approved=1")
      .filter((u) => visible(u, x))
      .map((u) => u.id);
  const notify = (x?: any) =>
    c.event("operations.changed", {}, undefined, x ? viewers(x) : undefined);
  const formatted = (x: any) => ({
    ...x,
    author_name: db.get("SELECT name FROM users WHERE id=?", x.author_id)?.name,
    owner_name: x.owner_id
      ? db.get("SELECT name FROM users WHERE id=?", x.owner_id)?.name
      : null,
    zone_name: x.zone_id
      ? db.get("SELECT name FROM venue_zones WHERE id=?", x.zone_id)?.name
      : null,
    reply_count: db.get(
      "SELECT COUNT(*) n FROM issue_replies WHERE issue_id=?",
      x.id,
    ).n,
  });
  function dedup(a: Auth, oid: string, kind: string) {
    const old = db.get("SELECT * FROM phase_operations WHERE id=?", oid);
    if (old && (old.user_id !== a.id || old.kind !== kind))
      bad(409, "Operation ID belongs to another operation");
    return old ? JSON.parse(old.response) : undefined;
  }
  const remember = (a: Auth, oid: string, kind: string, result: any) => {
    db.run(
      "INSERT INTO phase_operations VALUES(?,?,?,?)",
      oid,
      a.id,
      kind,
      JSON.stringify(result),
    );
    return result;
  };
  function pttAllowed(a: Auth, conversation: any) {
    if (conversation.kind === "broadcast") {
      const b = db.get(
        "SELECT * FROM broadcast_sessions WHERE conversation_id=?",
        conversation.id,
      );
      return (
        a.role === "admin" &&
        (!b || (b.state !== "ended" && b.expires_at > Date.now()))
      );
    }
    if (conversation.kind === "channel") {
      const op = db.get(
        "SELECT * FROM operational_teams WHERE channel_id=?",
        conversation.id,
      );
      return (
        a.role === "admin" ||
        (op
          ? team(a.id)?.id === op.team_id
          : !db.get("SELECT 1 FROM operational_teams LIMIT 1"))
      );
    }
    const other = db.get(
      "SELECT u.id,u.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.conversation_id=? AND m.user_id!=?",
      conversation.id,
      a.id,
    );
    if (!other) return false;
    const mine = team(a.id),
      theirs = team(other.id),
      d = duty();
    return (
      !!(mine && theirs && mine.id === theirs.id) ||
      !!(
        d &&
        ((d.userId === a.id && d.deviceId === a.device) ||
          d.userId === other.id)
      )
    );
  }
  function assertPtt(a: Auth, conv: any) {
    if (!pttAllowed(a, conv))
      bad(
        403,
        "Live PTT is limited to your operational team or duty admin. Chat and calls remain available.",
      );
    const e = exchange();
    if (
      e &&
      (e.admin_device === a.device || e.volunteer_id === a.id) &&
      e.conversation_id !== conv.id
    )
      bad(409, "Finish the admin exchange first");
    if (conv.kind === "private") {
      const d = duty();
      if (
        d &&
        db.get(
          "SELECT 1 FROM members WHERE conversation_id=? AND user_id=?",
          conv.id,
          d.userId,
        )
      ) {
        if (!e || e.conversation_id !== conv.id)
          bad(409, "Use Talk to admin to reserve the private exchange");
      }
    }
  }
  function permittedMedia(a: Auth, conv: any) {
    if (conv.kind === "broadcast") {
      const b = db.get(
        "SELECT * FROM broadcast_sessions WHERE conversation_id=?",
        conv.id,
      );
      return !b || (b.state !== "ended" && b.expires_at > Date.now());
    }
    if (!pttAllowed(a, conv)) return false;
    const d = duty();
    if (
      conv.kind === "private" &&
      d &&
      db.get(
        "SELECT 1 FROM members WHERE conversation_id=? AND user_id=?",
        conv.id,
        d.userId,
      )
    )
      return exchange()?.conversation_id === conv.id;
    return true;
  }
  const exchangeBusy = (device: string) => {
    const e = exchange();
    return e &&
      (e.admin_device === device ||
        db.get("SELECT user_id FROM devices WHERE id=?", device)?.user_id ===
          e.volunteer_id)
      ? e
      : null;
  };
  async function endExchange() {
    const e = db.get("SELECT * FROM admin_exchanges WHERE state='open'");
    if (e) {
      await c.closeChannel(e.conversation_id);
      db.run("UPDATE admin_exchanges SET state='ended' WHERE id=?", e.id);
      c.event("permissions", {}, undefined, [e.admin_id, e.volunteer_id]);
      notify();
    }
  }
  async function expire() {
    const e = db.get("SELECT * FROM admin_exchanges WHERE state='open'");
    if (
      e &&
      (e.expires_at < Date.now() ||
        !c.presence().some((p) => p.device === e.admin_device && p.onDuty) ||
        !c.presence().some((p) => p.user === e.volunteer_id && p.onDuty))
    )
      await endExchange();
    for (const b of db.all(
      "SELECT * FROM broadcast_sessions WHERE state!='ended' AND expires_at<?",
      Date.now(),
    )) {
      await c.closeChannel(b.conversation_id);
      db.run(
        "UPDATE broadcast_sessions SET state='ended' WHERE conversation_id=?",
        b.conversation_id,
      );
      c.event("permissions", {}, b.conversation_id);
    }
  }
  app.get("/api/operations", async (req) => {
    const a = auth(req),
      now = Date.now(),
      d = duty(),
      e = exchange();
    const issues = db
      .all(
        "SELECT * FROM issues ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,updated_at DESC",
      )
      .filter((x) => visible(a, x))
      .map(formatted);
    const users =
      a.role === "admin"
        ? db
            .all("SELECT id,name FROM users WHERE approved=1 AND role='staff'")
            .map((u) => {
              const devices = c
                .presence()
                .filter((p) => p.user === u.id && now - p.lastSeen < 30000);
              return {
                ...u,
                team: team(u.id),
                connected: devices.length > 0,
                onDuty: devices.some((p) => p.onDuty),
                checkin:
                  db.get(
                    "SELECT c.*,z.name zone_name,z.floor_id FROM checkins c JOIN venue_zones z ON z.id=c.zone_id WHERE c.user_id=?",
                    u.id,
                  ) || null,
              };
            })
        : [];
    const zones = db.all("SELECT * FROM venue_zones").map((z) => ({
      ...z,
      openIssues: issues.filter(
        (x) => x.zone_id === z.id && x.status !== "resolved",
      ).length,
      volunteers: users.filter(
        (u) => u.connected && u.onDuty && u.checkin?.zone_id === z.id,
      ).length,
    }));
    return {
      serverAt: now,
      team: team(a.id) || null,
      teams: db.all(
        "SELECT t.*,o.channel_id FROM teams t JOIN operational_teams o ON o.team_id=t.id",
      ),
      floors: db.all("SELECT * FROM venue_floors"),
      zones,
      issues,
      broadcasts:
        a.role === "admin"
          ? db.all(
              "SELECT b.*,c.name FROM broadcast_sessions b JOIN conversations c ON c.id=b.conversation_id WHERE b.creator_id=? AND b.state!='ended' AND b.expires_at>?",
              a.id,
              now,
            )
          : [],
      volunteers: users,
      checkin:
        db.get(
          "SELECT c.*,z.name zone_name,z.floor_id FROM checkins c JOIN venue_zones z ON z.id=c.zone_id WHERE c.user_id=?",
          a.id,
        ) || null,
      dutyAdmin: d
        ? {
            ...d,
            name: db.get("SELECT name FROM users WHERE id=?", d.userId)?.name,
            reachable: c
              .presence()
              .some(
                (p) =>
                  p.device === d.deviceId &&
                  p.onDuty &&
                  now - p.lastSeen < 30000,
              ),
            busy: !!e || !!c.busy(d.deviceId),
          }
        : null,
      exchange:
        e && [e.admin_id, e.volunteer_id].includes(a.id)
          ? {
              ...e,
              volunteer: users.find((u) => u.id === e.volunteer_id) || {
                id: e.volunteer_id,
                name: db.get(
                  "SELECT name FROM users WHERE id=?",
                  e.volunteer_id,
                )?.name,
              },
            }
          : null,
    };
  });
  app.post("/api/admin/operational-teams", async (req) =>
    serial(async () => {
      const a = admin(req),
        b = z
          .object({ name: z.string().trim().min(2).max(80) })
          .parse(req.body),
        prior = db.get("SELECT id FROM teams WHERE name=?", b.name),
        tid = prior?.id || id(),
        cid = id();
      if (db.get("SELECT 1 FROM operational_teams WHERE team_id=?", tid))
        bad(409, "Operational team already exists");
      if (!db.get("SELECT 1 FROM operational_teams LIMIT 1")) {
        // Switch existing receive rooms to the new permission model atomically.
        for (const legacy of db.all(
          "SELECT id FROM conversations WHERE kind IN ('channel','private')",
        ))
          await c.closeChannel(legacy.id);
      }
      db.transaction(() => {
        if (!prior)
          db.run("INSERT INTO teams(id,name) VALUES(?,?)", tid, b.name);
        db.run(
          "INSERT INTO conversations(id,name,kind,pair) VALUES(?,?,'channel',NULL)",
          cid,
          b.name,
        );
        db.run(
          "INSERT INTO operational_teams(team_id,channel_id) VALUES(?,?)",
          tid,
          cid,
        );
        for (const u of db.all(
          "SELECT id FROM users WHERE role='admin' AND approved=1",
        ))
          db.run("INSERT INTO members VALUES(?,?)", cid, u.id);
      });
      db.audit(a.id, "create-operational-team", tid);
      c.event("permissions", {});
      notify();
      return { id: tid, channelId: cid };
    }),
  );
  app.put("/api/admin/operational-assignments/:uid", async (req) =>
    serial(async () => {
      const a = admin(req),
        uid = key.parse((req.params as any).uid),
        b = z.object({ teamId: key.nullable() }).parse(req.body);
      if (
        !db.get(
          "SELECT 1 FROM users WHERE id=? AND approved=1 AND role='staff'",
          uid,
        )
      )
        bad(400, "Choose an approved volunteer");
      if (
        b.teamId &&
        !db.get("SELECT 1 FROM operational_teams WHERE team_id=?", b.teamId)
      )
        bad(400, "Team unavailable");
      const old = team(uid),
        affected = [
          old?.channel_id,
          b.teamId
            ? db.get(
                "SELECT channel_id FROM operational_teams WHERE team_id=?",
                b.teamId,
              ).channel_id
            : null,
        ].filter(Boolean);
      for (const b of db.all(
        "SELECT b.* FROM broadcast_sessions b JOIN members m ON m.conversation_id=b.conversation_id WHERE m.user_id=?",
        uid,
      )) {
        if (b.state !== "ended") {
          await c.closeChannel(b.conversation_id);
          db.run(
            "UPDATE broadcast_sessions SET state='ended' WHERE conversation_id=?",
            b.conversation_id,
          );
        }
        if (JSON.parse(b.team_ids).length)
          db.run(
            "DELETE FROM members WHERE conversation_id=? AND user_id=?",
            b.conversation_id,
            uid,
          );
      }
      await endExchange();
      // Rotate every affected receive room. Old cached tokens cannot join the new room.
      for (const cid of new Set(affected)) await c.closeChannel(cid);
      const privateIds = db
        .all(
          "SELECT c.id FROM conversations c JOIN members m ON m.conversation_id=c.id WHERE c.kind='private' AND m.user_id=?",
          uid,
        )
        .map((x) => x.id);
      for (const cid of privateIds) await c.closeChannel(cid);
      db.transaction(() => {
        if (old)
          db.run(
            "DELETE FROM members WHERE conversation_id=? AND user_id=?",
            old.channel_id,
            uid,
          );
        db.run("DELETE FROM operational_assignments WHERE user_id=?", uid);
        if (b.teamId) {
          db.run(
            "INSERT INTO operational_assignments VALUES(?,?)",
            uid,
            b.teamId,
          );
          db.run(
            "INSERT OR IGNORE INTO members VALUES(?,?)",
            affected.at(-1),
            uid,
          );
        }
        for (const cid of affected)
          db.run(
            "UPDATE operational_teams SET media_epoch=media_epoch+1 WHERE channel_id=?",
            cid,
          );
      });
      db.audit(a.id, "assign-operational-team", uid);
      c.event("permissions", {});
      notify();
      return { ok: true };
    }),
  );
  app.put("/api/admin/duty-admin", async (req) =>
    serial(async () => {
      const a = admin(req),
        b = z.object({ userId: key, deviceId: key }).parse(req.body);
      if (
        !db.get(
          "SELECT 1 FROM devices d JOIN users u ON u.id=d.user_id WHERE d.id=? AND u.id=? AND d.approved=1 AND u.approved=1 AND u.role='admin'",
          b.deviceId,
          b.userId,
        )
      )
        bad(400, "Choose an approved admin device");
      await endExchange();
      const old = duty();
      if (old)
        for (const p of db.all(
          "SELECT c.id FROM conversations c JOIN members m ON m.conversation_id=c.id WHERE c.kind='private' AND m.user_id=?",
          old.userId,
        ))
          await c.closeChannel(p.id);
      db.run(
        "INSERT INTO phase_settings VALUES('duty-admin',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        JSON.stringify(b),
      );
      db.audit(a.id, "set-duty-admin", b.userId);
      c.event("permissions", {});
      notify();
      return { ok: true };
    }),
  );
  app.post("/api/admin-exchange", async (req) =>
    serial(async () => {
      const a = auth(req),
        d = duty();
      if (!d) bad(409, "No duty admin designated");
      if (a.id === d.userId) bad(400, "Wait for a volunteer report");
      const p = c
        .presence()
        .find(
          (p) =>
            p.device === d.deviceId &&
            p.onDuty &&
            Date.now() - p.lastSeen < 30000,
        );
      if (!p) bad(409, "Duty admin unavailable");
      if (
        !c
          .presence()
          .some(
            (p) =>
              p.device === a.device &&
              p.onDuty &&
              Date.now() - p.lastSeen < 30000,
          )
      )
        bad(409, "Start an on-duty session first");
      if (c.busy(d.deviceId) || c.busy(a.device))
        bad(409, "Admin busy — try again");
      const active = exchange();
      if (active) {
        if (active.volunteer_id === a.id) return active;
        bad(409, "Admin busy — try again");
      }
      const pair = [a.id, d.userId].sort().join(":"),
        prior = db.get("SELECT * FROM conversations WHERE pair=?", pair),
        cid = prior?.id || id(),
        eid = id();
      if (!prior)
        db.transaction(() => {
          db.run(
            "INSERT INTO conversations(id,name,kind,pair) VALUES(?,?,'private',?)",
            cid,
            `${a.name} · Duty admin`,
            pair,
          );
          db.run("INSERT INTO members VALUES(?,?)", cid, a.id);
          db.run("INSERT INTO members VALUES(?,?)", cid, d.userId);
        });
      db.run(
        "INSERT INTO admin_exchanges VALUES(?,?,?,?,?,?,'open')",
        eid,
        cid,
        a.id,
        d.userId,
        d.deviceId,
        Date.now() + 90000,
      );
      c.event("permissions", {}, cid);
      notify();
      return exchange();
    }),
  );
  app.post("/api/admin-exchange/end", async (req) =>
    serial(async () => {
      const a = auth(req),
        e = exchange();
      if (e && ![e.admin_id, e.volunteer_id].includes(a.id))
        bad(403, "Exchange access denied");
      await endExchange();
      return { ok: true };
    }),
  );
  app.post("/api/admin-exchange/renew", async (req) => {
    const a = auth(req),
      e = exchange();
    if (!e || ![e.admin_id, e.volunteer_id].includes(a.id))
      bad(409, "Exchange ended");
    db.run(
      "UPDATE admin_exchanges SET expires_at=? WHERE id=?",
      Date.now() + 90000,
      e.id,
    );
    return { ok: true };
  });
  app.post("/api/admin/broadcasts", async (req) =>
    serial(async () => {
      const a = admin(req),
        b = z
          .object({
            teamIds: z.array(key).max(100),
            everyone: z.boolean().default(false),
          })
          .parse(req.body);
      if (exchangeBusy(a.device)) bad(409, "Finish the admin exchange first");
      if (!b.everyone && !b.teamIds.length)
        bad(400, "Select at least one team");
      for (const tid of b.teamIds)
        if (!db.get("SELECT 1 FROM operational_teams WHERE team_id=?", tid))
          bad(400, "Unknown operational team");
      const recipients = b.everyone
        ? db.all("SELECT id FROM users WHERE approved=1").map((u) => u.id)
        : db
            .all("SELECT user_id,team_id FROM operational_assignments")
            .filter((u) => b.teamIds.includes(u.team_id))
            .map((u) => u.user_id);
      const cid = id();
      db.transaction(() => {
        db.run(
          "INSERT INTO conversations(id,name,kind,pair) VALUES(?,?,'broadcast',NULL)",
          cid,
          b.everyone
            ? "Admin broadcast · Everyone"
            : "Admin broadcast · " +
                b.teamIds
                  .map(
                    (t) => db.get("SELECT name FROM teams WHERE id=?", t).name,
                  )
                  .join(", "),
        );
        for (const uid of new Set([...recipients, a.id]))
          db.run("INSERT INTO members VALUES(?,?)", cid, uid);
        db.run(
          "INSERT INTO broadcast_sessions VALUES(?,?,?,'preparing',?)",
          cid,
          a.id,
          JSON.stringify(b.everyone ? [] : b.teamIds),
          Date.now() + 120000,
        );
      });
      c.event("permissions", {}, cid);
      notify();
      return { id: cid, recipientCount: new Set(recipients).size };
    }),
  );
  app.post("/api/admin/broadcasts/:cid/end", async (req) =>
    serial(async () => {
      const a = admin(req),
        cid = key.parse((req.params as any).cid),
        b = db.get(
          "SELECT * FROM broadcast_sessions WHERE conversation_id=?",
          cid,
        );
      if (!b || b.creator_id !== a.id) bad(403, "Broadcast access denied");
      await c.closeChannel(cid);
      db.run(
        "UPDATE broadcast_sessions SET state='ended' WHERE conversation_id=?",
        cid,
      );
      c.event("permissions", {}, cid);
      return { ok: true };
    }),
  );
  app.post("/api/admin/floors", async (req) => {
    admin(req);
    const b = z
        .object({ name: z.string().trim().min(1).max(80) })
        .parse(req.body),
      fid = id();
    db.run("INSERT INTO venue_floors(id,name) VALUES(?,?)", fid, b.name);
    notify();
    return { id: fid };
  });
  app.post("/api/admin/zones", async (req) => {
    admin(req);
    const b = z
      .object({
        floorId: key,
        name: z.string().trim().min(1).max(80),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      })
      .parse(req.body);
    if (!db.get("SELECT 1 FROM venue_floors WHERE id=?", b.floorId))
      bad(400, "Floor unavailable");
    const zid = id();
    db.run(
      "INSERT INTO venue_zones VALUES(?,?,?,?,?)",
      zid,
      b.floorId,
      b.name,
      b.x,
      b.y,
    );
    notify();
    return { id: zid };
  });
  app.put("/api/admin/zones/:zid", async (req) => {
    admin(req);
    const zid = key.parse((req.params as any).zid),
      b = z
        .object({
          name: z.string().trim().min(1).max(80),
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
        })
        .parse(req.body);
    db.run(
      "UPDATE venue_zones SET name=?,x=?,y=? WHERE id=?",
      b.name,
      b.x,
      b.y,
      zid,
    );
    notify();
    return { ok: true };
  });
  app.post("/api/checkins", async (req) => {
    const a = auth(req),
      b = z
        .object({
          id: uuid,
          zoneId: key,
          reportedAt: z.number().int().positive(),
        })
        .parse(req.body);
    if (b.reportedAt > Date.now() + 300000)
      bad(400, "Check-in time is in the future");
    if (!db.get("SELECT 1 FROM venue_zones WHERE id=?", b.zoneId))
      bad(400, "Zone unavailable");
    const old = dedup(a, b.id, "checkin");
    if (old) return old;
    return db.transaction(() => {
      const current = db.get(
        "SELECT reported_at FROM checkins WHERE user_id=?",
        a.id,
      );
      const accepted = !current || b.reportedAt >= current.reported_at;
      if (accepted)
        db.run(
          "INSERT INTO checkins VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET operation_id=excluded.operation_id,zone_id=excluded.zone_id,reported_at=excluded.reported_at,confirmed_at=excluded.confirmed_at",
          a.id,
          b.id,
          b.zoneId,
          b.reportedAt,
          Date.now(),
        );
      const r = remember(a, b.id, "checkin", { ok: true, accepted });
      notify();
      return r;
    });
  });
  app.get("/api/threads/:iid", async (req) => {
    const a = auth(req),
      x = issue(a, key.parse((req.params as any).iid));
    return {
      ...formatted(x),
      replies: db.all(
        "SELECT r.*,u.name author_name FROM issue_replies r JOIN users u ON u.id=r.author_id WHERE issue_id=? ORDER BY r.seq",
        x.id,
      ),
    };
  });
  app.post("/api/threads", async (req) => {
    const a = auth(req),
      b = z
        .object({
          id: uuid,
          title: z.string().trim().min(1).max(120),
          description: z.string().trim().min(1).max(4000),
          priority: z.enum(["normal", "high", "urgent"]),
          audience: z.enum(["team", "everyone"]),
          teamId: key.optional(),
          zoneId: key.nullable().optional(),
          createdAt: z.number().int().positive(),
        })
        .parse(req.body);
    const old = dedup(a, b.id, "thread");
    if (old) {
      issue(a, b.id);
      return old;
    }
    const t = team(a.id);
    if (b.audience === "team" && !(a.role === "admin" ? b.teamId : t?.id))
      bad(400, "An operational team is required");
    const tid =
      b.audience === "team" ? (a.role === "admin" ? b.teamId : t.id) : null;
    if (tid && !db.get("SELECT 1 FROM operational_teams WHERE team_id=?", tid))
      bad(400, "Team unavailable");
    if (a.role !== "admin" && b.teamId && b.teamId !== t?.id)
      bad(403, "Team assignment changed; choose the current team");
    if (b.zoneId && !db.get("SELECT 1 FROM venue_zones WHERE id=?", b.zoneId))
      bad(400, "Zone unavailable");
    return db.transaction(() => {
      db.run(
        "INSERT INTO issues(id,author_id,title,description,priority,audience,team_id,zone_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        b.id,
        a.id,
        b.title,
        b.description,
        b.priority,
        b.audience,
        tid,
        b.zoneId || null,
        b.createdAt,
        Date.now(),
      );
      const r = remember(a, b.id, "thread", { id: b.id });
      notify(db.get("SELECT * FROM issues WHERE id=?", b.id));
      return r;
    });
  });
  app.post("/api/threads/:iid/replies", async (req) => {
    const a = auth(req),
      iid = key.parse((req.params as any).iid),
      b = z
        .object({
          id: uuid,
          text: z.string().trim().min(1).max(4000),
          createdAt: z.number().int().positive(),
        })
        .parse(req.body),
      x = issue(a, iid);
    const old = dedup(a, b.id, "reply:" + iid);
    if (old) return old;
    return db.transaction(() => {
      db.run(
        "INSERT INTO issue_replies(id,issue_id,author_id,text,created_at,received_at) VALUES(?,?,?,?,?,?)",
        b.id,
        iid,
        a.id,
        b.text,
        b.createdAt,
        Date.now(),
      );
      db.run(
        "UPDATE issues SET updated_at=?,version=version+1 WHERE id=?",
        Date.now(),
        iid,
      );
      const r = remember(a, b.id, "reply:" + iid, { id: b.id });
      notify(x);
      return r;
    });
  });
  app.post("/api/threads/:iid/:action", async (req) => {
    const a = auth(req),
      { iid, action } = req.params as any,
      x = issue(a, iid),
      b = z
        .object({ version: z.number().int(), ownerId: key.optional() })
        .parse(req.body);
    if (x.version !== b.version)
      bad(409, "Thread changed; refresh and try again");
    let status = x.status,
      owner = x.owner_id;
    if (action === "claim") {
      if (status !== "open" || owner)
        bad(409, "Another volunteer already owns this issue");
      status = "in_progress";
      owner = a.id;
    } else if (action === "resolve") {
      if (a.role !== "admin" && a.id !== x.author_id && a.id !== owner)
        bad(403, "Only the reporter, owner or admin may resolve");
      status = "resolved";
    } else if (action === "reopen") {
      if (a.role !== "admin") bad(403, "Admin required");
      status = "open";
      owner = null;
    } else if (action === "reassign") {
      if (a.role !== "admin") bad(403, "Admin required");
      const u = db.get(
        "SELECT id,role FROM users WHERE id=? AND approved=1",
        b.ownerId,
      );
      if (!u || !visible(u, x))
        bad(400, "Choose a member with access to this thread");
      owner = u.id;
      status = "in_progress";
    } else bad(404, "Unknown thread action");
    const changed = db.run(
      "UPDATE issues SET status=?,owner_id=?,updated_at=?,version=version+1 WHERE id=? AND version=?",
      status,
      owner,
      Date.now(),
      iid,
      b.version,
    );
    if (!changed.changes) bad(409, "Thread changed; refresh and try again");
    db.audit(a.id, "thread-" + action, iid);
    notify(x);
    return formatted(issue(a, iid));
  });
  for (const scope of ["floor", "issue"] as const) {
    app.post(`/api/phase2/${scope}s/:sid/files`, async (req) => {
      const a = auth(req),
        sid = key.parse((req.params as any).sid);
      if (scope === "floor") {
        admin(req);
        if (!db.get("SELECT 1 FROM venue_floors WHERE id=?", sid))
          bad(404, "Floor unavailable");
      } else {
        const x = issue(a, sid);
        if (a.id !== x.author_id && a.role !== "admin")
          bad(403, "Only the reporter or admin may attach a photo");
      }
      if (c.uploadsPaused() || c.busy(a.device) || exchangeBusy(a.device))
        bad(503, "Upload paused for live communication; retry when audio ends");
      const part = (await req.file()) || bad(400, "Image required");
      if (!["image/png", "image/jpeg", "image/webp"].includes(part.mimetype))
        bad(415, "Use PNG, JPEG or WebP");
      const bytes = await part.toBuffer();
      if (!bytes.length || bytes.length > 5 * 1024 * 1024)
        bad(413, "Image limit is 5 MB");
      const valid =
        part.mimetype === "image/png"
          ? bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : part.mimetype === "image/jpeg"
            ? bytes[0] === 255 && bytes[1] === 216
            : bytes.toString("ascii", 0, 4) === "RIFF" &&
              bytes.toString("ascii", 8, 12) === "WEBP";
      if (!valid) bad(415, "Invalid image contents");
      const digest = hash(bytes),
        prior = db.get(
          "SELECT * FROM phase_files WHERE scope=? AND scope_id=? AND uploader_id=? AND sha256=?",
          scope,
          sid,
          a.id,
          digest,
        );
      const fid = prior?.id || id();
      if (!prior) {
        const path = join(c.data, "files", fid);
        await writeFile(path + ".partial", bytes);
        await rename(path + ".partial", path);
        db.run(
          "INSERT INTO phase_files VALUES(?,?,?,?,?,?,?,?)",
          fid,
          scope,
          sid,
          a.id,
          part.filename.slice(0, 160),
          part.mimetype,
          bytes.length,
          digest,
        );
      }
      if (scope === "floor")
        db.run(
          "UPDATE venue_floors SET image_id=?,revision=revision+1 WHERE id=? AND image_id IS NOT ?",
          fid,
          sid,
          fid,
        );
      else
        db.run(
          "UPDATE issues SET photo_id=?,version=version+1,updated_at=? WHERE id=? AND photo_id IS NOT ?",
          fid,
          Date.now(),
          sid,
          fid,
        );
      notify(scope === "issue" ? issue(a, sid) : undefined);
      return { id: fid };
    });
  }
  app.get("/api/phase2/files/:fid", async (req, reply) => {
    const a = auth(req),
      f = db.get(
        "SELECT * FROM phase_files WHERE id=?",
        key.parse((req.params as any).fid),
      );
    if (!f) bad(404, "File unavailable");
    if (f.scope === "issue") issue(a, f.scope_id);
    reply
      .type(f.mime)
      .header(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      );
    return reply.send(createReadStream(join(c.data, "files", f.id)));
  });
  return {
    team,
    duty,
    exchange,
    exchangeBusy,
    pttAllowed,
    assertPtt,
    permittedMedia,
    expire,
    epoch: (cid: string) =>
      db.get(
        "SELECT media_epoch FROM operational_teams WHERE channel_id=?",
        cid,
      )?.media_epoch || 1,
    activeBroadcast: (cid: string) => {
      const b = db.get(
        "SELECT * FROM broadcast_sessions WHERE conversation_id=?",
        cid,
      );
      if (b)
        db.run(
          "UPDATE broadcast_sessions SET state='live',expires_at=? WHERE conversation_id=?",
          Date.now() + 60000,
          cid,
        );
    },
    invalidateBroadcasts: async (uid: string) => {
      for (const b of db.all(
        "SELECT b.conversation_id FROM broadcast_sessions b JOIN members m ON m.conversation_id=b.conversation_id WHERE b.state!='ended' AND m.user_id=?",
        uid,
      )) {
        await c.closeChannel(b.conversation_id);
        db.run(
          "UPDATE broadcast_sessions SET state='ended' WHERE conversation_id=?",
          b.conversation_id,
        );
      }
    },
  };
}
