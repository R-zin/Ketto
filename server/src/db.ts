import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','staff')), approved INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, public_key TEXT, approved INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), device_id TEXT NOT NULL REFERENCES devices(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS team_members(team_id TEXT REFERENCES teams(id),user_id TEXT REFERENCES users(id),PRIMARY KEY(team_id,user_id));
      CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('channel','private','broadcast')),pair TEXT UNIQUE);
      CREATE TABLE IF NOT EXISTS members(conversation_id TEXT REFERENCES conversations(id),user_id TEXT REFERENCES users(id),PRIMARY KEY(conversation_id,user_id));
      CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,conversation_id TEXT NOT NULL REFERENCES conversations(id),sender_id TEXT NOT NULL REFERENCES users(id),device_id TEXT NOT NULL REFERENCES devices(id),kind TEXT NOT NULL,text TEXT,attachment_id TEXT,created_at INTEGER NOT NULL,received_at INTEGER NOT NULL,delayed INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'received');
      CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),uploader_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts(message_id TEXT REFERENCES messages(id),user_id TEXT REFERENCES users(id),state TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(message_id,user_id));
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,conversation_id TEXT REFERENCES conversations(id),caller_id TEXT REFERENCES users(id),callee_id TEXT REFERENCES users(id),caller_device TEXT,callee_device TEXT,video INTEGER NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,ended_at INTEGER);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT,action TEXT,target TEXT,at INTEGER NOT NULL);
      INSERT OR IGNORE INTO conversations(id,name,kind) VALUES('all-staff','All Staff','broadcast');
    `);
    if (
      !this.all("PRAGMA table_info(devices)").some(
        (c) => c.name === "last_seen",
      )
    )
      this.db.exec("ALTER TABLE devices ADD COLUMN last_seen INTEGER");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS operational_teams(team_id TEXT PRIMARY KEY REFERENCES teams(id),channel_id TEXT UNIQUE NOT NULL REFERENCES conversations(id),media_epoch INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS operational_assignments(user_id TEXT NOT NULL REFERENCES users(id),team_id TEXT NOT NULL REFERENCES operational_teams(team_id),PRIMARY KEY(user_id,team_id));
      CREATE TABLE IF NOT EXISTS phase_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS venue_floors(id TEXT PRIMARY KEY,name TEXT NOT NULL,image_id TEXT,revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS venue_zones(id TEXT PRIMARY KEY,floor_id TEXT NOT NULL REFERENCES venue_floors(id),name TEXT NOT NULL,x REAL NOT NULL CHECK(x BETWEEN 0 AND 1),y REAL NOT NULL CHECK(y BETWEEN 0 AND 1));
      CREATE TABLE IF NOT EXISTS checkins(user_id TEXT PRIMARY KEY REFERENCES users(id),operation_id TEXT UNIQUE NOT NULL,zone_id TEXT NOT NULL REFERENCES venue_zones(id),reported_at INTEGER NOT NULL,confirmed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS issues(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,author_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,description TEXT NOT NULL,priority TEXT NOT NULL CHECK(priority IN ('normal','high','urgent')),audience TEXT NOT NULL CHECK(audience IN ('team','everyone')),team_id TEXT REFERENCES operational_teams(team_id),zone_id TEXT REFERENCES venue_zones(id),status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved')),owner_id TEXT REFERENCES users(id),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,photo_id TEXT);
      CREATE TABLE IF NOT EXISTS issue_replies(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,issue_id TEXT NOT NULL REFERENCES issues(id),author_id TEXT NOT NULL REFERENCES users(id),text TEXT NOT NULL,created_at INTEGER NOT NULL,received_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS phase_operations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,response TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS phase_files(id TEXT PRIMARY KEY,scope TEXT NOT NULL CHECK(scope IN ('floor','issue')),scope_id TEXT NOT NULL,uploader_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS admin_exchanges(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,volunteer_id TEXT NOT NULL,admin_id TEXT NOT NULL,admin_device TEXT NOT NULL,expires_at INTEGER NOT NULL,state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS broadcast_sessions(conversation_id TEXT PRIMARY KEY,creator_id TEXT NOT NULL,team_ids TEXT NOT NULL,state TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS archived_channels(conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),archived_at INTEGER NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id));
      CREATE INDEX IF NOT EXISTS issues_activity ON issues(updated_at);
      CREATE INDEX IF NOT EXISTS issue_replies_thread ON issue_replies(issue_id,seq);
      INSERT OR IGNORE INTO schema_migrations VALUES(2,strftime('%s','now')*1000);
      CREATE TABLE IF NOT EXISTS message_transcripts(message_id TEXT PRIMARY KEY REFERENCES messages(id),attachment_id TEXT NOT NULL,text TEXT NOT NULL DEFAULT '',state TEXT NOT NULL CHECK(state IN ('pending','processing','ready','unavailable','failed')),language TEXT NOT NULL DEFAULT 'en-US',engine TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL);
      INSERT OR IGNORE INTO schema_migrations VALUES(3,strftime('%s','now')*1000);
    `);
    if (
      !this.all("PRAGMA table_info(operational_assignments)").some(
        (c) => c.name === "team_id" && c.pk,
      )
    ) {
      this.transaction(() =>
        this.db.exec(`
        CREATE TABLE operational_assignments_multi(user_id TEXT NOT NULL REFERENCES users(id),team_id TEXT NOT NULL REFERENCES operational_teams(team_id),PRIMARY KEY(user_id,team_id));
        INSERT INTO operational_assignments_multi SELECT user_id,team_id FROM operational_assignments;
        DROP TABLE operational_assignments;
        ALTER TABLE operational_assignments_multi RENAME TO operational_assignments;
      `),
      );
    }
    this.db.exec(
      "INSERT OR IGNORE INTO schema_migrations VALUES(4,strftime('%s','now')*1000)",
    );
  }
  run(sql: string, ...args: any[]) {
    return this.db.prepare(sql).run(...args);
  }
  get(sql: string, ...args: any[]): any {
    return this.db.prepare(sql).get(...args);
  }
  all(sql: string, ...args: any[]): any[] {
    return this.db.prepare(sql).all(...args);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  audit(actor: string, action: string, target: string) {
    this.run(
      "INSERT INTO audit(actor,action,target,at) VALUES(?,?,?,?)",
      actor,
      action,
      target,
      Date.now(),
    );
  }
}
export const id = () => randomUUID();
