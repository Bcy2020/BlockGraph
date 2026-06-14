/**
 * BlockGraph MCP v0.1 — SQLite Store
 * Creates and manages the SQLite database with tables for all graph entities.
 */
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DB_DIR = ".blockgraph";
const DB_FILE = "blockgraph.db";

/**
 * Open (or create) the BlockGraph SQLite database.
 * Creates the .blockgraph directory if it does not exist.
 */
export function openStore(repoPath: string): Database.Database {
  const dir = path.join(repoPath, DB_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const dbPath = path.join(dir, DB_FILE);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initTables(db);
  return db;
}

/**
 * Close the database handle.
 */
export function closeStore(db: Database.Database): void {
  db.close();
}

/**
 * Delete the database file (for testing cleanup).
 */
export function deleteStore(repoPath: string): void {
  const dbPath = path.join(repoPath, DB_DIR, DB_FILE);
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  const walPath = dbPath + "-wal";
  if (fs.existsSync(walPath)) {
    fs.unlinkSync(walPath);
  }
  const shmPath = dbPath + "-shm";
  if (fs.existsSync(shmPath)) {
    fs.unlinkSync(shmPath);
  }
}

/**
 * Create all tables if they do not exist.
 */
function initTables(db: Database.Database): void {
  db.exec(`
    -- §8.1 CodeEntity
    CREATE TABLE IF NOT EXISTS code_entities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    -- §8.2 CodeEdge
    CREATE TABLE IF NOT EXISTS code_edges (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      source_entity_id TEXT NOT NULL,
      target_entity_id TEXT,
      confidence REAL NOT NULL DEFAULT 1.0,
      evidence TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (source_entity_id) REFERENCES code_entities(id),
      FOREIGN KEY (target_entity_id) REFERENCES code_entities(id)
    );

    -- §8.3 Block
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      confidence REAL NOT NULL DEFAULT 1.0,
      FOREIGN KEY (parent_id) REFERENCES blocks(id)
    );

    -- §8.4 BlockCodeMapping
    CREATE TABLE IF NOT EXISTS block_code_mappings (
      id TEXT PRIMARY KEY,
      block_id TEXT NOT NULL,
      code_entity_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owns',
      evidence TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (block_id) REFERENCES blocks(id),
      FOREIGN KEY (code_entity_id) REFERENCES code_entities(id)
    );

    -- §8.5 Port
    CREATE TABLE IF NOT EXISTS ports (
      id TEXT PRIMARY KEY,
      block_id TEXT NOT NULL,
      name TEXT NOT NULL,
      direction TEXT NOT NULL,
      contract TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (block_id) REFERENCES blocks(id)
    );

    -- §8.6 Connector
    CREATE TABLE IF NOT EXISTS connectors (
      id TEXT PRIMARY KEY,
      source_port_id TEXT NOT NULL,
      target_port_id TEXT NOT NULL,
      protocol TEXT NOT NULL DEFAULT 'unknown',
      evidence TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (source_port_id) REFERENCES ports(id),
      FOREIGN KEY (target_port_id) REFERENCES ports(id)
    );

    -- §8.7 Flow
    CREATE TABLE IF NOT EXISTS flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entrypoint_entity_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      FOREIGN KEY (entrypoint_entity_id) REFERENCES code_entities(id)
    );

    -- §8.8 FlowStep
    CREATE TABLE IF NOT EXISTS flow_steps (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      block_id TEXT NOT NULL,
      code_entity_id TEXT NOT NULL,
      trigger TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (flow_id) REFERENCES flows(id),
      FOREIGN KEY (block_id) REFERENCES blocks(id),
      FOREIGN KEY (code_entity_id) REFERENCES code_entities(id)
    );

    -- §8.9 UnknownBoundary
    CREATE TABLE IF NOT EXISTS unknown_boundaries (
      id TEXT PRIMARY KEY,
      related_entity_ids TEXT NOT NULL DEFAULT '[]',
      reason TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft'
    );

    -- §8.11 Snapshot
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      git_sha TEXT NOT NULL,
      created_at TEXT NOT NULL,
      accepted_graph_version TEXT NOT NULL
    );
  `);
}
