/**
 * YMQ IoT 云平台 - 数据库初始化与管理
 * 使用 sql.js（纯 JS SQLite），无需 C++ 编译
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, process.env.DB_PATH || './ymq_iot.db');

let rawDb = null;

/**
 * 封装 sql.js，提供类似 better-sqlite3 的 API
 */
class DbWrapper {
  constructor(db) {
    this._db = db;
  }

  exec(sql) {
    this._db.run(sql);
    this._save();
  }

  prepare(sql) {
    return new StatementWrapper(this._db, sql);
  }

  transaction(fn) {
    const self = this;
    return (...args) => {
      self._db.run('BEGIN TRANSACTION');
      try {
        fn(...args);
        self._db.run('COMMIT');
        self._save();
      } catch (e) {
        self._db.run('ROLLBACK');
        throw e;
      }
    };
  }

  _save() {
    try {
      const data = this._db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
    } catch (e) {
      console.error('[DB] 保存数据库失败:', e.message);
    }
  }

  pragma(str) {
    try { this._db.run(`PRAGMA ${str}`); } catch {}
  }
}

class StatementWrapper {
  constructor(db, sql) {
    this._db = db;
    this._sql = sql;
  }

  run(...params) {
    this._db.run(this._sql, params);
    // 尝试保存（对 INSERT/UPDATE/DELETE）
    try {
      const data = this._db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch {}
    return { lastInsertRowid: this._getLastId(), changes: this._db.getRowsModified() };
  }

  get(...params) {
    let stmt;
    try {
      stmt = this._db.prepare(this._sql);
      if (params.length > 0) stmt.bind(params);
      if (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        const row = {};
        for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
        return row;
      }
      return undefined;
    } finally {
      if (stmt) stmt.free();
    }
  }

  all(...params) {
    let stmt;
    try {
      stmt = this._db.prepare(this._sql);
      if (params.length > 0) stmt.bind(params);
      const results = [];
      while (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        const row = {};
        for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
        results.push(row);
      }
      return results;
    } finally {
      if (stmt) stmt.free();
    }
  }

  _getLastId() {
    try {
      const stmt = this._db.prepare('SELECT last_insert_rowid() as id');
      stmt.step();
      const id = stmt.get()[0];
      stmt.free();
      return id;
    } catch { return 0; }
  }
}

let wrappedDb = null;

function getDb() {
  if (!wrappedDb) {
    throw new Error('数据库未初始化，请先调用 initDatabase()');
  }
  return wrappedDb;
}

async function initDatabase() {
  const SQL = await initSqlJs();

  // 如果数据库文件已存在则加载
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    rawDb = new SQL.Database(buffer);
    console.log('[DB] 已加载现有数据库:', DB_PATH);
  } else {
    rawDb = new SQL.Database();
    console.log('[DB] 已创建新数据库:', DB_PATH);
  }

  wrappedDb = new DbWrapper(rawDb);
  wrappedDb.pragma('journal_mode = WAL');
  wrappedDb.pragma('foreign_keys = ON');

  // ========== 创建表 ==========

  wrappedDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      avatar_initial TEXT DEFAULT '',
      level INTEGER DEFAULT 1,
      total_training_count INTEGER DEFAULT 0,
      total_training_hours REAL DEFAULT 0,
      avg_accuracy REAL DEFAULT 0,
      last_training_date TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  wrappedDb.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      serial_number TEXT,
      firmware_version TEXT DEFAULT 'v1.0.0',
      status TEXT DEFAULT 'offline',
      battery_level INTEGER,
      runtime_seconds INTEGER DEFAULT 0,
      last_seen TEXT,
      ip_address TEXT,
      rssi INTEGER,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  wrappedDb.exec(`
    CREATE TABLE IF NOT EXISTS sensor_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      temperature REAL,
      humidity REAL,
      light INTEGER,
      smoke INTEGER,
      wind_speed REAL,
      pressure REAL,
      timestamp TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  wrappedDb.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      level TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      value REAL,
      threshold REAL,
      status TEXT DEFAULT 'unresolved',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      resolved_at TEXT
    )
  `);

  wrappedDb.exec(`
    CREATE TABLE IF NOT EXISTS alert_thresholds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sensor_type TEXT UNIQUE NOT NULL,
      min_value REAL,
      max_value REAL,
      enabled INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  wrappedDb.exec(`
    CREATE TABLE IF NOT EXISTS training_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      user_id INTEGER,
      mode TEXT NOT NULL DEFAULT 'fixed_point',
      duration_minutes INTEGER,
      serving_count INTEGER DEFAULT 0,
      accuracy REAL DEFAULT 0,
      max_speed REAL DEFAULT 0,
      avg_speed REAL DEFAULT 0,
      score TEXT,
      started_at TEXT,
      ended_at TEXT,
      status TEXT DEFAULT 'idle',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  wrappedDb.exec(`
    CREATE TABLE IF NOT EXISTS position_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      training_id INTEGER,
      x REAL NOT NULL,
      y REAL NOT NULL,
      zone TEXT,
      is_hit INTEGER DEFAULT 0,
      speed REAL,
      timestamp TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  wrappedDb.exec(`
    CREATE TABLE IF NOT EXISTS control_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      user_id INTEGER,
      command_type TEXT NOT NULL,
      command_value TEXT,
      result TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      responded_at TEXT
    )
  `);

  wrappedDb.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  wrappedDb.exec(`
    CREATE TABLE IF NOT EXISTS device_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_category TEXT DEFAULT 'info',
      description TEXT,
      details TEXT,
      timestamp TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // ========== 插入默认数据 ==========

  // 默认告警阈值
  const thresholds = [
    ['temperature', 10, 35], ['humidity', 30, 70],
    ['light', 100, 800], ['smoke', 0, 300]
  ];
  for (const [type, min, max] of thresholds) {
    wrappedDb.prepare(`
      INSERT OR IGNORE INTO alert_thresholds (sensor_type, min_value, max_value, enabled)
      VALUES (?, ?, ?, 1)
    `).run(type, min, max);
  }

  // 默认设备
  const devices = [
    ['ESP8266_001', 'ShuttleBot-001', 'SB2024001', 'v2.1.0'],
    ['ESP8266_002', 'ShuttleBot-002', 'SB2024002', 'v2.1.0'],
    ['ESP8266_003', 'ShuttleBot-003', 'SB2024003', 'v2.0.8']
  ];
  for (const [id, name, sn, fw] of devices) {
    wrappedDb.prepare(`
      INSERT OR IGNORE INTO devices (device_id, name, serial_number, firmware_version, status)
      VALUES (?, ?, ?, ?, 'offline')
    `).run(id, name, sn, fw);
  }

  // 默认管理员 (密码: admin123)
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('admin123', 10);
  wrappedDb.prepare(`
    INSERT OR IGNORE INTO users (username, email, password_hash, role, avatar_initial, level)
    VALUES (?, ?, ?, 'admin', ?, 5)
  `).run('admin', 'admin@shuttlebot.com', hash, '陈');

  // 默认系统设置
  const defaultSettings = [
    ['default_speed', '75'], ['default_interval', '2.5'], ['default_duration', '45'],
    ['sound_enabled', 'true'], ['auto_record', 'true'], ['alert_enabled', 'true'],
    ['power_saving', 'false'], ['mqtt_broker', 'bemfa.com:9501'], ['report_interval', '10']
  ];
  for (const [key, val] of defaultSettings) {
    wrappedDb.prepare(`
      INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)
    `).run(key, val);
  }

  console.log('[DB] 数据库初始化完成，所有表已创建');
  return wrappedDb;
}

module.exports = { getDb, initDatabase };
