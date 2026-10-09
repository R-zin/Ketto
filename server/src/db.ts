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
