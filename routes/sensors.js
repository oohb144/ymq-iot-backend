/**
 * 传感器数据路由 - 获取实时/历史传感器数据、CSV 导出
 */
const express = require('express');
const { getDb } = require('../db');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/sensors/latest - 获取最新传感器数据
router.get('/latest', (req, res) => {
  try {
    const db = getDb();
    const deviceId = req.query.device_id || 'ESP8266_001';
    
    const data = db.prepare(`
      SELECT * FROM sensor_data 
      WHERE device_id = ?
      ORDER BY timestamp DESC LIMIT 1
    `).get(deviceId);

    // 同时获取设备在线状态
    const device = db.prepare(`
      SELECT status, last_seen FROM devices WHERE device_id = ?
    `).get(deviceId);

    res.json({
      code: 0,
      data: {
        sensor: data || null,
        device_status: device ? device.status : 'offline',
        last_seen: device ? device.last_seen : null
      }
    });
  } catch (err) {
    console.error('[SENSORS] 获取最新数据失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// GET /api/sensors/history - 获取历史传感器数据
router.get('/history', (req, res) => {
  try {
    const db = getDb();
    const deviceId = req.query.device_id || 'ESP8266_001';
    const limit = Math.min(parseInt(req.query.limit) || 100, 5000);
    const range = req.query.range || '24h'; // 24h, 7d, 30d
    
    let timeFilter = '';
    switch (range) {
      case '1h':
        timeFilter = "AND timestamp > datetime('now', '-1 hour', 'localtime')";
        break;
      case '24h':
        timeFilter = "AND timestamp > datetime('now', '-24 hours', 'localtime')";
        break;
      case '7d':
        timeFilter = "AND timestamp > datetime('now', '-7 days', 'localtime')";
        break;
      case '30d':
        timeFilter = "AND timestamp > datetime('now', '-30 days', 'localtime')";
        break;
    }

    const data = db.prepare(`
      SELECT id, temperature, humidity, light, smoke, wind_speed, pressure, timestamp
      FROM sensor_data 
      WHERE device_id = ? ${timeFilter}
      ORDER BY timestamp ASC
      LIMIT ?
    `).all(deviceId, limit);

    // 统计摘要
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as count,
        AVG(temperature) as avg_temp,
        MAX(temperature) as max_temp,
        MIN(temperature) as min_temp,
        AVG(humidity) as avg_humi,
        MAX(humidity) as max_humi,
        MIN(humidity) as min_humi,
        AVG(light) as avg_light,
        MAX(light) as max_light,
        MIN(light) as min_light,
        AVG(smoke) as avg_smoke,
        MAX(smoke) as max_smoke,
        MIN(smoke) as min_smoke
      FROM sensor_data
      WHERE device_id = ? ${timeFilter}
    `).get(deviceId);

    res.json({ code: 0, data, stats });
  } catch (err) {
    console.error('[SENSORS] 获取历史数据失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// GET /api/sensors/export - CSV 导出
router.get('/export', (req, res) => {
  try {
    const db = getDb();
    const deviceId = req.query.device_id || 'ESP8266_001';
    const range = req.query.range || '7d';

    let timeFilter = '';
    switch (range) {
      case '24h':
        timeFilter = "AND timestamp > datetime('now', '-24 hours', 'localtime')";
        break;
      case '7d':
        timeFilter = "AND timestamp > datetime('now', '-7 days', 'localtime')";
        break;
      case '30d':
        timeFilter = "AND timestamp > datetime('now', '-30 days', 'localtime')";
        break;
    }

    const data = db.prepare(`
      SELECT timestamp, temperature, humidity, light, smoke, wind_speed, pressure
      FROM sensor_data 
      WHERE device_id = ? ${timeFilter}
      ORDER BY timestamp ASC
    `).all(deviceId);

    // 构建 CSV
    let csv = 'timestamp,temperature,humidity,light,smoke,wind_speed,pressure\n';
    for (const row of data) {
      csv += `${row.timestamp},${row.temperature ?? ''},${row.humidity ?? ''},${row.light ?? ''},${row.smoke ?? ''},${row.wind_speed ?? ''},${row.pressure ?? ''}\n`;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=sensor_data_${deviceId}_${range}.csv`);
    // BOM for Excel 中文兼容
    res.send('\ufeff' + csv);
  } catch (err) {
    console.error('[SENSORS] CSV 导出失败:', err);
    res.status(500).json({ code: 500, message: '导出失败' });
  }
});

// GET /api/sensors/stats - 数据统计摘要
router.get('/stats', (req, res) => {
  try {
    const db = getDb();
    const deviceId = req.query.device_id || 'ESP8266_001';

    const total = db.prepare('SELECT COUNT(*) as count FROM sensor_data WHERE device_id = ?').get(deviceId);
    const today = db.prepare(`
      SELECT COUNT(*) as count FROM sensor_data 
      WHERE device_id = ? AND timestamp > datetime('now', 'start of day', 'localtime')
    `).get(deviceId);
    const latest = db.prepare(`
      SELECT * FROM sensor_data WHERE device_id = ? ORDER BY timestamp DESC LIMIT 1
    `).get(deviceId);

    res.json({
      code: 0,
      data: {
        total_records: total.count,
        today_records: today.count,
        latest: latest || null
      }
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

module.exports = router;
