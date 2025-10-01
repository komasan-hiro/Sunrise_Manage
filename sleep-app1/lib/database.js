const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const sqlite3 = require('sqlite3').verbose();

// データベースファイルのパスを指定 (プロジェクトのルートに 'sleep.sqlite3' を作成)
const dbPath = path.join(__dirname, '..', 'sleep.sqlite3');

// データベースに接続
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('データベース接続エラー:', err.message);
  } else {
    console.log('データベースに正常に接続しました。');
    // データベース接続成功時にテーブル作成処理を呼び出す
    createSleepDataTable();
    createAlarmsTable();
  }
});

/**
 * 睡眠データ(sleep_data)テーブルを作成する関数
 */
function createSleepDataTable() {
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS sleep_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      total_minutes INTEGER,
      deep_minutes INTEGER,
      light_minutes INTEGER,
      rem_minutes INTEGER,
      wake_minutes INTEGER,
      efficiency INTEGER
    );
  `;
  
  db.run(createTableSql, (err) => {
    if (err) {
      console.error('テーブル作成エラー:', err.message);
    } else {
      console.log('sleep_data テーブルが正常に作成されたか、すでに存在します。');
    }
  });
}

function createAlarmsTable() {
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS alarms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hour INTEGER NOT NULL,
      minute INTEGER NOT NULL,
      is_on INTEGER NOT NULL DEFAULT 1,
      sound_nonrem TEXT,
      sound_rem TEXT
    );
  `;
  db.run(createTableSql, (err) => {
    if (err) {
      console.error('alarmsテーブル作成エラー:', err.message);
    } else {
      console.log('alarms テーブルが正常に作成されたか、すでに存在します。');
    }
  });
}

/**
 * 睡眠データをデータベースに保存する関数
 * @param {object} sleepLog - Fitbit APIから取得した睡眠ログオブジェクト
 */
function saveSleepData(sleepLog) {
  const insertSql = `
    INSERT OR IGNORE INTO sleep_data (date, total_minutes, deep_minutes, light_minutes, rem_minutes, wake_minutes, efficiency)
    VALUES (?, ?, ?, ?, ?, ?, ?);
  `;
  const params = [
    sleepLog.dateOfSleep,
    sleepLog.minutesAsleep,
    sleepLog.levels.summary.deep?.minutes || 0,
    sleepLog.levels.summary.light?.minutes || 0,
    sleepLog.levels.summary.rem?.minutes || 0,
    sleepLog.levels.summary.wake?.minutes || 0,
    sleepLog.efficiency // ★efficiencyの値を追加
  ];

  db.run(insertSql, params, function(err) {
    if (err) {
      console.error('データ保存エラー:', err.message);
    } else if (this.changes > 0) {
      console.log(`${sleepLog.dateOfSleep} の睡眠データをデータベースに保存しました。`);
    } else {
      console.log(`${sleepLog.dateOfSleep} のデータはすでに存在します。`);
    }
  });
}

/**
 * 過去N日分の睡眠データを取得する関数
 * @param {number} days - 取得する日数
 * @returns {Promise<Array>} 睡眠データの配列を解決するPromise
 */
function getRecentSleepData(days = 7) {
  const querySql = `
    SELECT * FROM sleep_data
    ORDER BY date DESC
    LIMIT ?;
  `;
  
  return new Promise((resolve, reject) => {
    db.all(querySql, [days], (err, rows) => {
      if (err) {
        console.error('データ取得エラー:', err.message);
        reject(err);
      } else {
        // 日付の昇順に並べ替えて返す
        resolve(rows.reverse());
      }
    });
  });
}

/**
 * ★★★ 新規追加 ★★★
 * 設定されているすべてのアラームを取得する関数
 * @returns {Promise<Array>} アラーム設定の配列
 */
function getAlarms() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM alarms ORDER BY hour, minute", [], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        // is_onをBooleanに変換して返す
        const alarms = rows.map(row => ({...row, isOn: row.is_on === 1}));
        resolve(alarms);
      }
    });
  });
}

/**
 * ★★★ 新規追加 ★★★
 * 新しいアラームをデータベースに保存する関数
 * @param {object} alarm - { hour, minute, soundNonrem, soundRem }
 * @returns {Promise<object>} 保存されたアラーム情報
 */
function addAlarm(alarm) {
  const sql = `INSERT INTO alarms (hour, minute, sound_nonrem, sound_rem) VALUES (?, ?, ?, ?)`;
  return new Promise((resolve, reject) => {
    db.run(sql, [alarm.hour, alarm.minute, alarm.soundNonrem, alarm.soundRem], function(err) {
      if (err) {
        reject(err);
      } else {
        // 追加したアラームの情報を取得して返す
        resolve({ id: this.lastID, ...alarm, isOn: true });
      }
    });
  });
}

/**
 * ★★★ 新規追加 ★★★
 * アラームを削除する関数
 * @param {number} id - 削除するアラームのID
 * @returns {Promise}
 */
function deleteAlarm(id) {
  return new Promise((resolve, reject) => {
    db.run("DELETE FROM alarms WHERE id = ?", [id], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

/**
 * ★★★ 新規追加 ★★★
 * アラームのオン/オフを切り替える関数
 * @param {number} id - 対象のアラームのID
 * @param {boolean} isOn - 新しい状態 (true=オン, false=オフ)
 * @returns {Promise}
 */
function toggleAlarm(id, isOn) {
  const sql = "UPDATE alarms SET is_on = ? WHERE id = ?";
  return new Promise((resolve, reject) => {
    db.run(sql, [isOn ? 1 : 0, id], function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

// 他のファイルから使えるように、新しい関数を公開する
module.exports = {
  saveSleepData,
  getRecentSleepData,
  getAlarms,    // ★追加
  addAlarm,     // ★追加
  deleteAlarm,  // ★追加
  toggleAlarm   // ★追加
};
