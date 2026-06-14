/**
 * 训练记录路由 - 训练历史、统计数据
 */
const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

// GET /api/training - 获取训练记录列表
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const records = db.prepare(`
      SELECT tr.*, u.username, d.name as device_name
      FROM training_records tr
      LEFT JOIN users u ON tr.user_id = u.id
      LEFT JOIN devices d ON tr.device_id = d.device_id
      ORDER BY tr.created_at DESC LIMIT ?
    `).all(limit);
    res.json({ code: 0, data: records });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// GET /api/training/current - 获取当前进行中的训练
router.get('/current', (req, res) => {
  try {
    const db = getDb();
    const current = db.prepare(`
      SELECT * FROM training_records 
      WHERE status IN ('running', 'paused')
      ORDER BY created_at DESC LIMIT 1
    `).get();
    res.json({ code: 0, data: current || null });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// GET /api/training/stats - 训练统计摘要
router.get('/stats', (req, res) => {
  try {
    const db = getDb();
    const totalHours = db.prepare(`
      SELECT COALESCE(SUM(duration_minutes), 0) / 60.0 as hours FROM training_records WHERE status = 'completed'
    `).get();
    const totalServings = db.prepare(`
      SELECT COALESCE(SUM(serving_count), 0) as count FROM training_records
    `).get();
    const avgAccuracy = db.prepare(`
      SELECT COALESCE(AVG(accuracy), 0) as avg FROM training_records WHERE accuracy > 0
    `).get();
    const maxSpeed = db.prepare(`
      SELECT COALESCE(MAX(max_speed), 0) as max FROM training_records
    `).get();

    // 按模式分布
    const modeDistribution = db.prepare(`
      SELECT mode, COUNT(*) as count FROM training_records GROUP BY mode
    `).all();

    // 最近7天训练趋势
    const weeklyTrend = db.prepare(`
      SELECT 
        date(created_at) as date,
        COUNT(*) as sessions,
        SUM(duration_minutes) as total_minutes,
        AVG(accuracy) as avg_accuracy
      FROM training_records 
      WHERE created_at > datetime('now', '-7 days', 'localtime') AND status = 'completed'
      GROUP BY date(created_at)
      ORDER BY date ASC
    `).all();

    res.json({
      code: 0,
      data: {
        total_hours: Math.round(totalHours.hours * 10) / 10,
        total_servings: totalServings.count,
        avg_accuracy: Math.round(avgAccuracy.avg),
        max_speed: maxSpeed.max,
        mode_distribution: modeDistribution,
        weekly_trend: weeklyTrend
      }
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// GET /api/training/trend - 每日训练趋势（最近30天）
router.get('/trend', (req, res) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days) || 30;
    const trend = db.prepare(`
      SELECT 
        date(created_at) as date,
        COUNT(*) as sessions,
        SUM(duration_minutes) as total_minutes,
        SUM(serving_count) as total_servings,
        AVG(accuracy) as avg_accuracy,
        MAX(max_speed) as max_speed
      FROM training_records 
      WHERE created_at > datetime('now', '-' || ? || ' days', 'localtime') AND status = 'completed'
      GROUP BY date(created_at)
      ORDER BY date ASC
    `).all(days);
    res.json({ code: 0, data: trend });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// GET /api/training/live - 实时训练数据
router.get('/live', (req, res) => {
  try {
    const db = getDb();
    const latest = db.prepare(`
      SELECT motor_rpm, serving_speed, serving_count, accuracy, training_mode, training_status,
             uwb_x, uwb_y, player_x, player_y
      FROM sensor_data ORDER BY timestamp DESC LIMIT 1
    `).get();
    
    // Get last 20 sensor readings for live chart
    const history = db.prepare(`
      SELECT serving_speed, accuracy, timestamp
      FROM sensor_data 
      WHERE serving_speed IS NOT NULL
      ORDER BY timestamp DESC LIMIT 20
    `).all().reverse();
    
    res.json({ code: 0, data: { current: latest || null, speed_history: history } });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// GET /api/training/:id - 获取训练详情
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const record = db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id);
    if (!record) return res.status(404).json({ code: 404, message: '训练记录不存在' });

    // 获取位置数据
    const positions = db.prepare(`
      SELECT * FROM position_data WHERE training_id = ? ORDER BY timestamp ASC
    `).all(req.params.id);

    res.json({ code: 0, data: { record, positions } });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

module.exports = router;
