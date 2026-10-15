import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Customer, Call } from "@/lib/types";

const databases = new Map<string, DatabaseSync>();
export function db() {
  const path = resolve(
    process.env.DATABASE_PATH || "./data/support-lab.sqlite",
  );
  if (databases.has(path)) return databases.get(path)!;
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,company TEXT NOT NULL,initials TEXT NOT NULL,personality TEXT NOT NULL,skill TEXT NOT NULL,style TEXT NOT NULL,voice INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active',role TEXT NOT NULL DEFAULT 'admin',export_format TEXT NOT NULL DEFAULT 'csv',export_job TEXT NOT NULL DEFAULT 'idle');
    CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id),scenario TEXT NOT NULL,status TEXT NOT NULL,turns INTEGER NOT NULL DEFAULT 0,max_turns INTEGER NOT NULL,tool_calls INTEGER NOT NULL DEFAULT 0,escalations INTEGER NOT NULL DEFAULT 0,knowledge_used INTEGER NOT NULL DEFAULT 0,workflow_used INTEGER NOT NULL DEFAULT 0,verified INTEGER NOT NULL DEFAULT 0,error TEXT,learning_status TEXT NOT NULL DEFAULT 'pending',batch INTEGER NOT NULL,started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),ended_at TEXT,busy_until INTEGER NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_call ON calls((1)) WHERE status IN ('running','paused');
    CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY,call_id TEXT UNIQUE NOT NULL REFERENCES calls(id),customer_id TEXT NOT NULL REFERENCES customers(id),subject TEXT NOT NULL,status TEXT NOT NULL,resolution TEXT,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY,call_id TEXT NOT NULL REFERENCES calls(id),role TEXT NOT NULL,text TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY,call_id TEXT NOT NULL REFERENCES calls(id),name TEXT NOT NULL,input TEXT NOT NULL,output TEXT NOT NULL,success INTEGER NOT NULL,duration_ms INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id),level TEXT NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY,signature TEXT UNIQUE NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,evidence TEXT NOT NULL,source_call TEXT NOT NULL REFERENCES calls(id),uses INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY,signature TEXT UNIQUE NOT NULL,title TEXT NOT NULL,recipe TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 0,uses INTEGER NOT NULL DEFAULT 0,source_call TEXT NOT NULL REFERENCES calls(id),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY,call_id TEXT NOT NULL REFERENCES calls(id),role TEXT NOT NULL,profile TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,input_tokens INTEGER,output_tokens INTEGER,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT OR IGNORE INTO meta VALUES ('batch','1');`);
  databases.set(path, database);
  seed();
  return database;
}
export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db()
    .prepare(sql)
    .all(...params) as T[];
}
export function one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db()
    .prepare(sql)
    .get(...params) as T | undefined;
}
export function run(sql: string, ...params: SQLInputValue[]) {
  return db()
    .prepare(sql)
    .run(...params);
}
export function transaction<T>(fn: () => T): T {
  db().exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db().exec("COMMIT");
    return result;
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
}
export function seed() {
  const people = [
    [
      "maya",
      "Maya Chen",
      "maya@bloom.studio",
      "Bloom Studio",
      "MC",
      "Frustrated; busy and worried about missing a deadline.",
      "Nontechnical",
      "Short, direct sentences. Avoid technical jargon.",
      0,
    ],
    [
      "oliver",
      "Oliver Brooks",
      "oliver@northstar.dev",
      "Northstar Labs",
      "OB",
      "Calm, patient, technically knowledgeable.",
      "Advanced",
      "Precise descriptions; ask focused technical questions.",
      1,
    ],
    [
      "jules",
      "Jules Rivera",
      "jules@paperplane.co",
      "Paperplane",
      "JR",
      "Confused; needs reassurance and clear guidance.",
      "Beginner",
      "Conversational; ask for one step at a time.",
      2,
    ],
  ];
  for (const person of people)
    run(
      "INSERT OR IGNORE INTO customers (id,name,email,company,initials,personality,skill,style,voice) VALUES (?,?,?,?,?,?,?,?,?)",
      ...person,
    );
}
export function customer(id: string) {
  const result = one<Customer>("SELECT * FROM customers WHERE id=?", id);
  if (!result) throw new Error("Customer not found");
  return result;
}
export function getCall(id: string) {
  const result = one<Call>("SELECT * FROM calls WHERE id=?", id);
  if (!result) throw new Error("Call not found");
  return result;
}
export function log(
  customerId: string,
  level: string,
  event: string,
  detail: string,
) {
  run(
    "INSERT INTO logs(customer_id,level,event,detail) VALUES (?,?,?,?)",
    customerId,
    level,
    event,
    detail,
  );
}
export function batch() {
  return Number(
    one<{ value: string }>("SELECT value FROM meta WHERE key=?", "batch")!
      .value,
  );
}
