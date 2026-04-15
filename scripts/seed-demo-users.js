const path = require("path");
const crypto = require("crypto");
const sqlite3 = require("sqlite3").verbose();
const { Pool } = require("pg");

const usePostgres = Boolean(process.env.DATABASE_URL);
const sqliteDb = usePostgres ? null : new sqlite3.Database(path.join(__dirname, "..", "poker.db"));
const pgPool = usePostgres
  ? new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  })
  : null;

const DEMO_USERS = [
  { name: "demo1", password: "demo123", chips: 1500 },
  { name: "demo2", password: "demo123", chips: 1500 },
  { name: "demo3", password: "demo123", chips: 1500 },
];

function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => {
    i += 1;
    return `$${i}`;
  });
}

async function run(sql, params = []) {
  if (usePostgres) {
    await pgPool.query(toPgSql(sql), params);
    return;
  }
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function get(sql, params = []) {
  if (usePostgres) {
    const result = await pgPool.query(toPgSql(sql), params);
    return result.rows[0];
  }
  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

async function initDb() {
  if (usePostgres) {
    await run(`
      CREATE TABLE IF NOT EXISTS profiles (
        name TEXT PRIMARY KEY,
        chips INTEGER NOT NULL DEFAULT 1000,
        hands INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        password_salt TEXT,
        password_hash TEXT,
        avatar_data TEXT
      )
    `);
    return;
  }
  await run(`
    CREATE TABLE IF NOT EXISTS profiles (
      name TEXT PRIMARY KEY,
      chips INTEGER NOT NULL DEFAULT 1000,
      hands INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      password_salt TEXT,
      password_hash TEXT,
      avatar_data TEXT
    )
  `);
}

async function upsertDemoUser(user) {
  const existing = await get("SELECT name FROM profiles WHERE name = ?", [user.name]);
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(user.password, salt);
  if (existing) {
    await run(
      `UPDATE profiles
       SET chips = ?, password_salt = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP
       WHERE name = ?`,
      [user.chips, salt, hash, user.name],
    );
    return "updated";
  }
  await run(
    `INSERT INTO profiles (name, chips, hands, wins, password_salt, password_hash)
     VALUES (?, ?, 0, 0, ?, ?)`,
    [user.name, user.chips, salt, hash],
  );
  return "created";
}

async function main() {
  await initDb();
  for (const user of DEMO_USERS) {
    const status = await upsertDemoUser(user);
    // eslint-disable-next-line no-console
    console.log(`${status}: ${user.name} / ${user.password}`);
  }
  if (pgPool) await pgPool.end();
  if (sqliteDb) sqliteDb.close();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("seed failed:", err.message);
  if (pgPool) await pgPool.end();
  if (sqliteDb) sqliteDb.close();
  process.exit(1);
});
