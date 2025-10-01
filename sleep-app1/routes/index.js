const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const fitbit = require('../lib/fitbit-api');
const db = require('../lib/database');

/**
 * ★★★ 新規追加 ★★★
 * 睡眠ステージのデータから平均睡眠サイクル長（分）を計算する関数
 * @param {Array} sleepLevels - Fitbit APIの levels.data 配列
 * @returns {number} 平均サイクル時間（分）、計算できない場合は null
 */
function calculateAverageCycle(sleepLevels) {
    if (!sleepLevels || sleepLevels.length < 2) return null;

    let deepSleepTimestamps = [];
    // 全データの中から、深い睡眠(deep)が始まった時刻だけを抽出する
    for (let i = 1; i < sleepLevels.length; i++) {
        // "light" または "rem" から "deep" に切り替わった瞬間を探す
        if (sleepLevels[i].level === 'deep' && sleepLevels[i-1].level !== 'deep') {
            deepSleepTimestamps.push(new Date(sleepLevels[i].dateTime));
        }
    }

    if (deepSleepTimestamps.length < 2) return null; // サイクルを計算するには最低2回の深い睡眠が必要

    let cycleDurations = [];
    // 深い睡眠が始まった時刻の差分から、各サイクルの長さを計算
    for (let i = 1; i < deepSleepTimestamps.length; i++) {
        const diffMs = deepSleepTimestamps[i] - deepSleepTimestamps[i-1];
        cycleDurations.push(diffMs / (1000 * 60)); // ミリ秒を分に変換
    }

    // 外れ値（短すぎる/長すぎるサイクル）を除外して、より正確な平均を計算
    const filteredDurations = cycleDurations.filter(d => d > 45 && d < 150);
    if (filteredDurations.length === 0) return null;

    const averageCycleMinutes = filteredDurations.reduce((a, b) => a + b, 0) / filteredDurations.length;
    return Math.round(averageCycleMinutes);
}


/**
 * GET /
 * メインページを表示する
 */
router.get('/', async (req, res, next) => {
  const tokens = fitbit.loadTokens();
  if (!tokens) { return res.render('authorize', { title: 'Fitbit 連携' }); }

  try {
    const today = new Date().toISOString().split('T')[0];
    const sleepData = await fitbit.getSleepData(today);
    if (sleepData) {
      db.saveSleepData(sleepData);
    }
    
    const recentData = await db.getRecentSleepData(7);
    const labels = recentData.map(d => new Date(d.date).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' }));
    const weeklyData = recentData.map(d => parseFloat((d.total_minutes / 60).toFixed(2)));
    const latestData = recentData.length > 0 ? recentData[recentData.length - 1] : null;
    const todaySleep = latestData ? `${Math.floor(latestData.total_minutes / 60)}:${(latestData.total_minutes % 60).toString().padStart(2, '0')}` : "データなし";
    
    // ★最新の睡眠データから平均サイクルを計算
    const userCycle = calculateAverageCycle(latestData?.levels?.data) || 90; // 計算できなければデフォルト90分
    const recommendation = `あなたの睡眠サイクルは約${userCycle}分です。就寝時刻を入力して、最適な起床時間を計算しましょう。`;
    
    const soundsDirectory = path.join(__dirname, '../public/sounds/');
    const [files, alarms] = await Promise.all([ fs.readdir(soundsDirectory), db.getAlarms() ]);
    const audioFiles = files.filter(file => ['.mp3', '.wav', '.ogg'].includes(path.extname(file).toLowerCase()));

    const pageData = { todaySleep, weeklyLabels: labels, weeklyData, recommendation, alarms };

    res.render('index', { 
      title: 'Sunrise Manage',
      data: pageData,
      sounds: audioFiles,
      jsonData: JSON.stringify(pageData)
    });
  } catch (error) {
    if (error.code === 'ENOENT' && error.path.includes('sounds')) {
      await fs.mkdir(path.join(__dirname, '../public/sounds/'), { recursive: true });
      return res.redirect('/');
    }
    console.error('データ処理中にエラー:', error);
    res.render('authorize', { title: 'エラー：再認証してください' });
  }
});

/**
 * POST /calculate-wakeup
 * 就寝時刻を受け取り、おすすめ起床時刻を計算して結果を返す
 */
router.post('/calculate-wakeup', async (req, res, next) => {
  try {
    const bedtimeInput = req.body.bedtime;
    const [hours, minutes] = bedtimeInput.split(':').map(Number);
    
    const bedtime = new Date();
    bedtime.setHours(hours, minutes, 0, 0);
    if (bedtime < new Date()) {
      bedtime.setDate(bedtime.getDate() + 1);
    }
    
    const formatTime = (date) => `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    
    // ★最新の睡眠ログを取得し、そこからユーザーのサイクルを再計算
    const latestSleepLog = await fitbit.getSleepData(new Date().toISOString().split('T')[0]);
    const userCycle = calculateAverageCycle(latestSleepLog?.levels?.data) || 90;
    
    const recommendationResult = {
      message: `あなたの睡眠サイクル(約${userCycle}分)に基づくと、${bedtimeInput}に就寝した場合のおすすめ起床時刻は...`,
      times: [
        `${formatTime(new Date(bedtime.getTime() + (userCycle * 3 * 60 * 1000)))} (サイクル 3回)`,
        `${formatTime(new Date(bedtime.getTime() + (userCycle * 4 * 60 * 1000)))} (サイクル 4回)`,
        `${formatTime(new Date(bedtime.getTime() + (userCycle * 5 * 60 * 1000)))} (サイクル 5回)`
      ]
    };

    // --- ページ再描画のために、GETルートとほぼ同じデータを再度準備 ---
    const recentData = await db.getRecentSleepData(7);
    const labels = recentData.map(d => new Date(d.date).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' }));
    const weeklyData = recentData.map(d => parseFloat((d.total_minutes / 60).toFixed(2)));
    const latestData = recentData.length > 0 ? recentData[recentData.length - 1] : null;
    const todaySleep = latestData ? `${Math.floor(latestData.total_minutes / 60)}:${(latestData.total_minutes % 60).toString().padStart(2, '0')}` : "データなし";
    
    const soundsDirectory = path.join(__dirname, '../public/sounds/');
    const [files, alarms] = await Promise.all([ fs.readdir(soundsDirectory), db.getAlarms() ]);
    const audioFiles = files.filter(file => ['.mp3', '.wav', '.ogg'].includes(path.extname(file).toLowerCase()));

    const pageData = { todaySleep, weeklyLabels: labels, weeklyData, recommendation: recommendationResult, alarms };

    res.render('index', { 
      title: 'Sunrise Manage',
      data: pageData,
      sounds: audioFiles,
      jsonData: JSON.stringify(pageData)
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;