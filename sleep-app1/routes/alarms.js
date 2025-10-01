const express = require('express');
const router = express.Router();
const db = require('../lib/database');
const fitbit = require('../lib/fitbit-api'); // ★Fitbit APIモジュールを読み込む

// POST /alarms/add - 新しいアラームを追加
router.post('/add', async (req, res, next) => {
  try {
    const newAlarm = await db.addAlarm(req.body);
    res.json({ success: true, alarm: newAlarm });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /alarms/delete/:id - アラームを削除
router.post('/delete/:id', async (req, res, next) => {
  try {
    await db.deleteAlarm(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /alarms/toggle/:id - アラームのオン/オフを切り替え
router.post('/toggle/:id', async (req, res, next) => {
  try {
    await db.toggleAlarm(req.params.id, req.body.isOn);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * ★★★ 新規追加 ★★★
 * GET /alarms/check
 * 発火すべきアラームがあるか、どの音を鳴らすべきかチェックする
 */
router.get('/check', async (req, res, next) => {
  try {
    const alarms = await db.getAlarms();
    const now = new Date();
    let alarmToFire = null;

    for (const alarm of alarms) {
      if (alarm.is_on === 1 && alarm.hour === now.getHours() && alarm.minute === now.getMinutes()) {
        alarmToFire = alarm;
        break;
      }
    }

    if (alarmToFire) {
      const sleepState = await fitbit.getCurrentSleepState();
      let soundToPlay = null;

      if (sleepState === 'wake' || sleepState === 'rem') {
        soundToPlay = alarmToFire.sound_rem;
      } else { // light, deep, または不明な場合
        soundToPlay = alarmToFire.sound_nonrem;
      }
      
      console.log(`アラーム発火準備: 状態=${sleepState}, サウンド=${soundToPlay}`);
      res.json({ shouldFire: true, sound: soundToPlay });

    } else {
      res.json({ shouldFire: false });
    }
  } catch (error) {
    console.error('アラームチェックエラー:', error);
    res.status(500).json({ shouldFire: false, message: 'Error checking alarms' });
  }
});

module.exports = router;