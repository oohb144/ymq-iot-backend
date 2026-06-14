/**
 * 设备管理路由 - 设备列表、设备详情、运行日志
 */
const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

// GET /api/devices - 获取所有设备列表
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const devices = db.prepare('SELECT * FROM devices ORDER BY updated_at DESC').all();
    res.json({ code: 0, data: devices });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// GET /api/devices/:id - 获取设备详情
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const device = db.prepare('SELECT * FROM devices WHERE device_id = ?').get(req.params.id);
    if (!device) return res.status(404).json({ code: 404, message: '设备不存在' });

    // 获取最新传感器数据
    const latestSensor = db.prepare(`
      SELECT * FROM sensor_data WHERE device_id = ? ORDER BY timestamp DESC LIMIT 1
    `).get(req.params.id);

    // 获取最近告警
    const recentAlerts = db.prepare(`
      SELECT * FROM alerts WHERE device_id = ? ORDER BY created_at DESC LIMIT 5
    `).all(req.params.id);

    res.json({ code: 0, data: { device, latest_sensor: latestSensor, recent_alerts: recentAlerts } });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// GET /api/devices/:id/logs - 获取设备运行日志
router.get('/:id/logs', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const logs = db.prepare(`
      SELECT * FROM device_logs WHERE device_id = ? ORDER BY timestamp DESC LIMIT ?
    `).all(req.params.id, limit);
    res.json({ code: 0, data: logs });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// GET /api/devices/:id/position - 获取设备位置数据(UWB)
router.get('/:id/position', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
    const trainingId = req.query.training_id;

    let query = 'SELECT * FROM position_data WHERE device_id = ?';
    const params = [req.params.id];
    if (trainingId) { query += ' AND training_id = ?'; params.push(trainingId); }
    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const positions = db.prepare(query).all(...params);
    res.json({ code: 0, data: positions });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

module.exports = router;
