/**
 * 告警路由 - 获取告警列表、标记处理、阈值配置
 */
const express = require('express');
const { getDb } = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/alerts - 获取告警列表
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const status = req.query.status; // unresolved, resolved, acknowledged
    const level = req.query.level;   // critical, warning, info

    let where = 'WHERE 1=1';
    const params = [];
    if (status) { where += ' AND a.status = ?'; params.push(status); }
    if (level) { where += ' AND a.level = ?'; params.push(level); }

    const alerts = db.prepare(`
      SELECT a.*, d.name as device_name
      FROM alerts a
      LEFT JOIN devices d ON a.device_id = d.device_id
      ${where}
      ORDER BY a.created_at DESC LIMIT ?
    `).all(...params, limit);

    // 统计各级别数量
    const counts = db.prepare(`
      SELECT level, status, COUNT(*) as count
      FROM alerts GROUP BY level, status
    `).all();

    const summary = { critical: 0, warning: 0, info: 0, unresolved: 0 };
    for (const c of counts) {
      if (c.status === 'unresolved') summary.unresolved += c.count;
      summary[c.level] = (summary[c.level] || 0) + c.count;
    }

    res.json({ code: 0, data: alerts, summary });
  } catch (err) {
    console.error('[ALERTS] 获取告警失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// PUT /api/alerts/:id/resolve - 标记告警为已处理
router.put('/:id/resolve', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    db.prepare(`
      UPDATE alerts SET status = 'resolved', resolved_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(req.params.id);
    res.json({ code: 0, message: '告警已标记为已处理' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '操作失败' });
  }
});

// PUT /api/alerts/:id/acknowledge - 确认告警
router.put('/:id/acknowledge', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    db.prepare(`UPDATE alerts SET status = 'acknowledged' WHERE id = ?`).run(req.params.id);
    res.json({ code: 0, message: '告警已确认' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '操作失败' });
  }
});

// GET /api/alerts/thresholds - 获取告警阈值配置
router.get('/thresholds', (req, res) => {
  try {
    const db = getDb();
    const thresholds = db.prepare('SELECT * FROM alert_thresholds ORDER BY sensor_type').all();
    res.json({ code: 0, data: thresholds });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// PUT /api/alerts/thresholds - 更新告警阈值
router.put('/thresholds', authMiddleware, (req, res) => {
  try {
    const { thresholds } = req.body;
    if (!Array.isArray(thresholds)) {
      return res.status(400).json({ code: 400, message: 'thresholds 必须是数组' });
    }

    const db = getDb();
    const stmt = db.prepare(`
      UPDATE alert_thresholds SET min_value = ?, max_value = ?, enabled = ?, updated_at = datetime('now', 'localtime')
      WHERE sensor_type = ?
    `);

    const transaction = db.transaction((items) => {
      for (const item of items) {
        stmt.run(item.min_value, item.max_value, item.enabled ? 1 : 0, item.sensor_type);
      }
    });
    transaction(thresholds);

    res.json({ code: 0, message: '告警阈值已更新' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '更新失败' });
  }
});

// DELETE /api/alerts/:id - 删除告警
router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM alerts WHERE id = ?').run(req.params.id);
    res.json({ code: 0, message: '告警已删除' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '删除失败' });
  }
});

module.exports = router;
