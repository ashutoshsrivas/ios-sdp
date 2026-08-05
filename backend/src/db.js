const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('./config');

let pool;

// Create the database if missing, run the schema, and seed a default admin.
async function init() {
  // First connect without a database selected so we can CREATE DATABASE.
  const bootstrap = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true,
  });
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.db.name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await bootstrap.changeUser({ database: config.db.name });

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await bootstrap.query(schema);
  await bootstrap.end();

  pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.name,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
  });

  await migrate();
  await seedDefaults();
  return pool;
}

// Add a column only if it doesn't already exist (MySQL lacks ADD COLUMN IF NOT EXISTS).
async function ensureColumn(table, column, definition) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [config.db.name, table, column]
  );
  if (rows.length === 0) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

// Make an existing NOT NULL column nullable (idempotent — only runs when needed).
async function ensureNullable(table, column, definition) {
  const [rows] = await pool.query(
    `SELECT is_nullable AS n FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [config.db.name, table, column]
  );
  if (rows.length && String(rows[0].n).toUpperCase() === 'NO') {
    await pool.query(`ALTER TABLE \`${table}\` MODIFY \`${column}\` ${definition}`);
  }
}

// Bring pre-existing databases up to the multi-bootcamp schema.
async function migrate() {
  await ensureColumn('students', 'bootcamp_id', 'INT NULL');
  await ensureColumn('students', 'roster_id', 'INT NULL');
  await ensureColumn('teams', 'bootcamp_id', 'INT NULL');
  await ensureColumn('teams', 'remarks', 'TEXT NULL');
  await ensureColumn('teams', 'table_id', 'VARCHAR(20) NULL');
  await ensureColumn('roster', 'sort_order', 'INT NULL');
  await ensureColumn('tasks', 'bootcamp_id', 'INT NULL');
  await ensureColumn('tasks', 'file_url', 'VARCHAR(1024) NULL');
  await ensureColumn('tasks', 'file_name', 'VARCHAR(255) NULL');
  await ensureColumn('rubrics', 'bootcamp_id', 'INT NULL');
  await ensureColumn('questions', 'bootcamp_id', 'INT NULL');
  await ensureColumn('certificates', 'verify_code', 'VARCHAR(40) NULL');
  await ensureColumn('certificates', 'revoked', 'TINYINT NOT NULL DEFAULT 0');
  // Allow comment-only rubric scores (a mentor may leave a comment without a number).
  await ensureNullable('rubric_scores', 'score', 'DECIMAL(6,2) NULL');
}

async function seedDefaults() {
  // Ensure at least one bootcamp exists, then backfill orphaned rows into it.
  const [camps] = await pool.query(`SELECT id FROM bootcamps ORDER BY id LIMIT 1`);
  let defaultCampId = camps[0]?.id;
  if (!defaultCampId) {
    const [r] = await pool.query(
      `INSERT INTO bootcamps (name, description, registration_open)
       VALUES ('Cohort 1', 'Default cohort', 1)`
    );
    defaultCampId = r.insertId;
  }
  // Backfill any rows created before bootcamps existed.
  for (const t of ['students', 'teams', 'tasks', 'rubrics', 'questions']) {
    await pool.query(`UPDATE \`${t}\` SET bootcamp_id = ? WHERE bootcamp_id IS NULL`, [
      defaultCampId,
    ]);
  }

  const [admins] = await pool.query(`SELECT id FROM users WHERE role='admin' LIMIT 1`);
  if (admins.length === 0) {
    const hash = await bcrypt.hash(config.admin.password, 10);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?, 'admin')`,
      [config.admin.name, config.admin.email.toLowerCase(), hash]
    );
    // eslint-disable-next-line no-console
    console.log(
      `\n  Seeded default admin: ${config.admin.email} / ${config.admin.password}\n  (change the password after first login)\n`
    );
  }
}

function getPool() {
  if (!pool) throw new Error('DB not initialised. Call init() first.');
  return pool;
}

// Convenience query helper.
async function q(sql, params) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

module.exports = { init, getPool, q };
