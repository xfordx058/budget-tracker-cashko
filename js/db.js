import * as SQLite from './lib/wa-sqlite.mjs';

const DB_NAME = 'cashko.db';
const STORE_NAME = 'opfs';

async function initDB() {
  const module = await SQLite.default();
  const sqlite3 = SQLite.Factory(module);
  const db = await sqlite3.open_v2(DB_NAME, SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE, STORE_NAME);
  
  await sqlite3.exec(db, `
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('inc','exp')),
      desc TEXT NOT NULL,
      cat TEXT NOT NULL,
      ico TEXT NOT NULL,
      date TEXT NOT NULL,
      amt REAL NOT NULL CHECK (amt > 0),
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
  `);
  
  await sqlite3.exec(db, `
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  
  return { sqlite3, db, module };
}

function getDB() {
  return window.__cashkoDB || (window.__cashkoDB = initDB());
}

export async function getAllTransactions() {
  const { sqlite3, db } = await getDB();
  const rows = [];
  await sqlite3.exec(db, 'SELECT id, type, desc, cat, ico, date, amt FROM transactions ORDER BY date DESC, id DESC', {
    row: (row) => rows.push({
      id: row[0],
      type: row[1],
      desc: row[2],
      cat: row[3],
      ico: row[4],
      date: row[5],
      amt: row[6]
    })
  });
  return rows;
}

export async function addTransaction(tx) {
  const { sqlite3, db } = await getDB();
  const stmt = await sqlite3.prepare(db, 'INSERT INTO transactions (id, type, desc, cat, ico, date, amt) VALUES (?, ?, ?, ?, ?, ?, ?)');
  try {
    await sqlite3.bind(stmt, [tx.id, tx.type, tx.desc, tx.cat, tx.ico, tx.date, tx.amt]);
    await sqlite3.step(stmt);
  } finally {
    await sqlite3.finalize(stmt);
  }
}

export async function deleteTransaction(id) {
  const { sqlite3, db } = await getDB();
  const stmt = await sqlite3.prepare(db, 'DELETE FROM transactions WHERE id = ?');
  try {
    await sqlite3.bind(stmt, [id]);
    await sqlite3.step(stmt);
  } finally {
    await sqlite3.finalize(stmt);
  }
}

export async function clearAllTransactions() {
  const { sqlite3, db } = await getDB();
  await sqlite3.exec(db, 'DELETE FROM transactions');
}

export async function setSetting(key, value) {
  const { sqlite3, db } = await getDB();
  const stmt = await sqlite3.prepare(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  try {
    await sqlite3.bind(stmt, [key, typeof value === 'string' ? value : JSON.stringify(value)]);
    await sqlite3.step(stmt);
  } finally {
    await sqlite3.finalize(stmt);
  }
}

export async function getSetting(key, defaultValue = null) {
  const { sqlite3, db } = await getDB();
  let result = defaultValue;
  const stmt = await sqlite3.prepare(db, 'SELECT value FROM settings WHERE key = ?');
  try {
    await sqlite3.bind(stmt, [key]);
    const rc = await sqlite3.step(stmt);
    if (rc === SQLite.SQLITE_ROW) {
      const val = sqlite3.column(stmt, 0);
      try {
        // Try to parse JSON, fallback to string
        result = JSON.parse(val);
      } catch {
        result = val;
      }
    }
  } finally {
    await sqlite3.finalize(stmt);
  }
  return result;
}

export async function getSettings() {
  const { sqlite3, db } = await getDB();
  const settings = {};
  await sqlite3.exec(db, 'SELECT key, value FROM settings', {
    row: (row) => {
      const key = row[0];
      const val = row[1];
      try {
        settings[key] = JSON.parse(val);
      } catch {
        settings[key] = val;
      }
    }
  });
  return settings;
}

export async function bulkImport(data) {
  const { sqlite3, db } = await getDB();
  await sqlite3.exec(db, 'BEGIN TRANSACTION');
  try {
    await clearAllTransactions();
    if (data.budget !== undefined && data.budget !== null) {
      await setSetting('budget', data.budget);
    }
    if (data.name) {
      await setSetting('name', data.name);
    }
    if (data.appName) {
      await setSetting('appName', data.appName);
    }
    if (Array.isArray(data.tx)) {
      for (const tx of data.tx) {
        const stmt = await sqlite3.prepare(db, 'INSERT INTO transactions (id, type, desc, cat, ico, date, amt) VALUES (?, ?, ?, ?, ?, ?, ?)');
        try {
          await sqlite3.bind(stmt, [tx.id, tx.type, tx.desc, tx.cat, tx.ico, tx.date, tx.amt]);
          await sqlite3.step(stmt);
        } finally {
          await sqlite3.finalize(stmt);
        }
      }
    }
    await sqlite3.exec(db, 'COMMIT');
  } catch (err) {
    await sqlite3.exec(db, 'ROLLBACK');
    throw err;
  }
}

export async function getAllData() {
  const tx = await getAllTransactions();
  const settings = await getSettings();
  return {
    tx: tx.reverse(), // keep original order roughly? we stored desc; better sort by date asc for export
    budget: settings.budget ?? 3000,
    name: settings.name ?? 'Student',
    appName: settings.appName ?? 'COINFLOW'
  };
}
