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
    CREATE TABLE IF NOT EXISTS completion_checks (id INTEGER PRIMARY KEY,call_id TEXT NOT NULL REFERENCES calls(id),customer_message_id INTEGER UNIQUE NOT NULL REFERENCES messages(id),customer_satisfied INTEGER NOT NULL,explanation_complete INTEGER NOT NULL,evidence_supported INTEGER NOT NULL,open_questions TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS activities (id INTEGER PRIMARY KEY,call_id TEXT NOT NULL REFERENCES calls(id),name TEXT NOT NULL,input TEXT NOT NULL,output TEXT NOT NULL,success INTEGER NOT NULL,duration_ms INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id),level TEXT NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY,signature TEXT UNIQUE NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,evidence TEXT NOT NULL,source_call TEXT NOT NULL REFERENCES calls(id),uses INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY,signature TEXT UNIQUE NOT NULL,title TEXT NOT NULL,recipe TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 0,uses INTEGER NOT NULL DEFAULT 0,source_call TEXT NOT NULL REFERENCES calls(id),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY,call_id TEXT NOT NULL REFERENCES calls(id),role TEXT NOT NULL,profile TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,input_tokens INTEGER,output_tokens INTEGER,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS engineering_handoffs (id TEXT PRIMARY KEY,call_id TEXT UNIQUE NOT NULL REFERENCES calls(id),ticket_id TEXT NOT NULL REFERENCES tickets(id),customer_id TEXT NOT NULL REFERENCES customers(id),status TEXT NOT NULL DEFAULT 'open',severity TEXT NOT NULL,summary TEXT NOT NULL,customer_impact TEXT NOT NULL,reproduction_steps TEXT NOT NULL,expected_result TEXT NOT NULL,actual_result TEXT NOT NULL,evidence TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT OR IGNORE INTO meta VALUES ('batch','1');`);
  const columns = database.prepare("PRAGMA table_info(calls)").all();
  if (!columns.some((column) => column.name === "repair_verified")) {
    database.exec(
      "ALTER TABLE calls ADD COLUMN repair_verified INTEGER NOT NULL DEFAULT 0; UPDATE calls SET repair_verified=verified;",
    );
  }
  if (!columns.some((column) => column.name === "closing_customer_message_id"))
    database.exec(
      "ALTER TABLE calls ADD COLUMN closing_customer_message_id INTEGER REFERENCES messages(id);",
    );
  const messageColumns = database.prepare("PRAGMA table_info(messages)").all();
  if (!messageColumns.some((column) => column.name === "kind"))
    database.exec(
      "ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'dialogue';",
    );
  const checkColumns = database
    .prepare("PRAGMA table_info(completion_checks)")
    .all();
  if (!checkColumns.some((column) => column.name === "assessment_error")) {
    database.exec(
      "ALTER TABLE completion_checks ADD COLUMN assessment_error TEXT; ALTER TABLE completion_checks ADD COLUMN requires_investigation INTEGER NOT NULL DEFAULT 0;",
    );
    database
      .prepare(
        "UPDATE completion_checks SET assessment_error=reason WHERE reason LIKE ?",
      )
      .run("Customer completion could not be checked:%");
  }
  const migrate = (table: string, definitions: Record<string, string>) => {
    const present = database.prepare(`PRAGMA table_info(${table})`).all();
    for (const [name, definition] of Object.entries(definitions))
      if (!present.some((column) => column.name === name))
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition};`);
  };
  migrate("customers", {
    export_bug: "TEXT NOT NULL DEFAULT 'none'",
    recovery_failures: "INTEGER NOT NULL DEFAULT 0",
    report_range: "TEXT NOT NULL DEFAULT 'q1'",
    report_columns: 'TEXT NOT NULL DEFAULT \'["revenue","tickets"]\'',
    draft_range: "TEXT NOT NULL DEFAULT 'q1'",
    draft_columns: 'TEXT NOT NULL DEFAULT \'["revenue","tickets"]\'',
    report_applied: "INTEGER NOT NULL DEFAULT 1",
    report_downloaded: "INTEGER NOT NULL DEFAULT 0",
    report_builder: "INTEGER NOT NULL DEFAULT 0",
  });
  migrate("calls", {
    scenario_seed: "TEXT",
    scenario_case: "TEXT",
    followup_asked: "INTEGER NOT NULL DEFAULT 0",
    outcome_verified: "INTEGER NOT NULL DEFAULT 0",
    outcome: "TEXT",
  });
  database.exec(
    "UPDATE calls SET outcome_verified=1,outcome='resolution' WHERE verified=1 AND outcome IS NULL;",
  );
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
