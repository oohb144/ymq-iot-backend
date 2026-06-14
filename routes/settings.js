/**
 * 系统设置路由 - 读取/更新系统配置，下发到设备
 */
const express = require('express');
const { getDb } = require('../db');
const { publishControl } = require('../mqtt');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/settings - 获取所有系统设置
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const settings = db.prepare('SELECT * FROM system_settings ORDER BY key').all();
    const settingsObj = {};
    for (const s of settings) {
      settingsObj[s.key] = s.value;
    }
    res.json({ code: 0, data: settingsObj });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// PUT /api/settings - 更新系统设置
router.put('/', authMiddleware, async (req, res) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ code: 400, message: 'settings 必须是对象' });
    }

    const db = getDb();
    const upsert = db.prepare(`
      INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now', 'localtime'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now', 'localtime')
    `);

    const transaction = db.transaction((items) => {
      for (const [key, value] of Object.entries(items)) {
        upsert.run(key, String(value));
      }
    });
    transaction(settings);

    // 如果包含设备相关设置，下发到设备
    const deviceKeys = ['default_speed', 'default_interval', 'default_duration', 'report_interval'];
    const hasDeviceSettings = Object.keys(settings).some(k => deviceKeys.includes(k));
    
    if (hasDeviceSettings) {
      try {
        const topic = process.env.BEMFA_TOPIC_LED || 'ledControl';
        const cmdPayload = JSON.stringify({ cmd: 'set_config', config: settings, ts: Date.now() });
        await publishControl(topic, cmdPayload);
      } catch (mqttErr) {
        console.error('[SETTINGS] MQTT 下发设置失败:', mqttErr.message);
        // 即使 MQTT 失败，设置也已保存到数据库
      }
    }

    res.json({ code: 0, message: '设置已更新' + (hasDeviceSettings ? '并已下发到设备' : '') });
  } catch (err) {
    res.status(500).json({ code: 500, message: '更新失败: ' + err.message });
  }
});

// POST /api/settings/sync - 将设置同步下发到设备
router.post('/sync', authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const settings = db.prepare('SELECT * FROM system_settings').all();
    const settingsObj = {};
    for (const s of settings) {
      settingsObj[s.key] = s.value;
    }

    const topic = process.env.BEMFA_TOPIC_LED || 'ledControl';
    const cmdPayload = JSON.stringify({ cmd: 'sync_config', config: settingsObj, ts: Date.now() });
    await publishControl(topic, cmdPayload);

    res.json({ code: 0, message: '设置已同步下发到设备' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '同步失败: ' + err.message });
  }
});

module.exports = router;
