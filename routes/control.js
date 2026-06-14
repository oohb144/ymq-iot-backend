/**
 * 设备控制路由 - LED 控制、训练模式下发、参数下发
 */
const express = require('express');
const { getDb } = require('../db');
const { publishControl, addDeviceLog } = require('../mqtt');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/control/led - LED 开关控制
router.post('/led', optionalAuth, async (req, res) => {
  try {
    const { action } = req.body; // 'on' or 'off'
    if (!['on', 'off'].includes(action)) {
      return res.status(400).json({ code: 400, message: 'action 必须是 on 或 off' });
    }

    const topic = process.env.BEMFA_TOPIC_LED || 'ledControl';
    
    // 通过 MQTT 发布控制指令
    await publishControl(topic, action);

    // 记录控制日志
    const db = getDb();
    db.prepare(`
      INSERT INTO control_logs (device_id, user_id, command_type, command_value, result)
      VALUES ('ESP8266_001', ?, 'led', ?, 'success')
    `).run(req.user ? req.user.id : null, action);

    addDeviceLog('ESP8266_001', 'led_control', 'info', 
      `LED ${action === 'on' ? '开启' : '关闭'}指令已发送`,
      JSON.stringify({ action, user: req.user ? req.user.username : 'anonymous' })
    );

    res.json({ code: 0, message: `LED ${action === 'on' ? '开启' : '关闭'}指令已发送` });
  } catch (err) {
    console.error('[CONTROL] LED 控制失败:', err);
    res.status(500).json({ code: 500, message: '控制指令发送失败: ' + err.message });
  }
});

// POST /api/control/training/mode - 切换训练模式
router.post('/training/mode', authMiddleware, async (req, res) => {
  try {
    const { mode } = req.body; // 'fixed_point', 'self_training', 'footwork'
    const validModes = ['fixed_point', 'self_training', 'footwork'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({ code: 400, message: `mode 必须是 ${validModes.join(', ')} 之一` });
    }

    const topic = process.env.BEMFA_TOPIC_LED || 'ledControl'; // 复用控制主题
    const cmdPayload = JSON.stringify({
      cmd: 'set_mode',
      mode: mode,
      ts: Date.now()
    });

    await publishControl(topic, cmdPayload);

    // 更新训练记录
    const db = getDb();
    db.prepare(`
      UPDATE training_records SET mode = ?, status = 'running'
      WHERE id = (SELECT id FROM training_records WHERE device_id = 'ESP8266_001' AND status = 'running' ORDER BY created_at DESC LIMIT 1)
    `).run(mode);

    addDeviceLog('ESP8266_001', 'mode_change', 'info', 
      `训练模式切换: ${mode}`,
      JSON.stringify({ mode, user: req.user.username })
    );

    res.json({ code: 0, message: `训练模式已切换为 ${mode}` });
  } catch (err) {
    res.status(500).json({ code: 500, message: '模式切换失败: ' + err.message });
  }
});

// POST /api/control/training/action - 训练状态控制（开始/暂停/停止）
router.post('/training/action', authMiddleware, async (req, res) => {
  try {
    const { action } = req.body; // 'start', 'pause', 'stop'
    const validActions = ['start', 'pause', 'stop'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ code: 400, message: `action 必须是 ${validActions.join(', ')} 之一` });
    }

    const topic = process.env.BEMFA_TOPIC_LED || 'ledControl';
    const cmdPayload = JSON.stringify({ cmd: action, ts: Date.now() });
    await publishControl(topic, cmdPayload);

    const db = getDb();
    const statusMap = { start: 'running', pause: 'paused', stop: 'completed' };
    
    if (action === 'start') {
      // 创建新训练记录
      db.prepare(`
        INSERT INTO training_records (device_id, user_id, mode, started_at, status)
        VALUES ('ESP8266_001', ?, 'fixed_point', datetime('now', 'localtime'), 'running')
      `).run(req.user.id);
    } else {
      // 更新现有训练状态
      db.prepare(`
        UPDATE training_records SET status = ?
          ${action === 'stop' ? ", ended_at = datetime('now', 'localtime')" : ''}
        WHERE id = (SELECT id FROM training_records WHERE device_id = 'ESP8266_001' AND status IN ('running', 'paused') ORDER BY created_at DESC LIMIT 1)
      `).run(statusMap[action]);
    }

    addDeviceLog('ESP8266_001', `training_${action}`, 'info', 
      `训练${action === 'start' ? '开始' : action === 'pause' ? '暂停' : '停止'}`,
      JSON.stringify({ action, user: req.user.username })
    );

    res.json({ code: 0, message: `训练${action === 'start' ? '已开始' : action === 'pause' ? '已暂停' : '已停止'}` });
  } catch (err) {
    res.status(500).json({ code: 500, message: '操作失败: ' + err.message });
  }
});

// POST /api/control/training/params - 训练参数下发
router.post('/training/params', authMiddleware, async (req, res) => {
  try {
    const { speed, interval, duration, zone } = req.body;

    const topic = process.env.BEMFA_TOPIC_LED || 'ledControl';
    const cmdPayload = JSON.stringify({
      cmd: 'set_params',
      params: { speed, interval, duration, zone },
      ts: Date.now()
    });
    await publishControl(topic, cmdPayload);

    addDeviceLog('ESP8266_001', 'params_update', 'info', 
      `训练参数更新: 速度=${speed}, 间隔=${interval}, 时长=${duration}, 区域=${zone}`,
      JSON.stringify({ speed, interval, duration, zone })
    );

    res.json({ code: 0, message: '训练参数已下发到设备' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '参数下发失败: ' + err.message });
  }
});

// POST /api/control/device - 通用设备控制
router.post('/device', authMiddleware, async (req, res) => {
  try {
    const { device_id, command, value } = req.body;
    if (!device_id || !command) {
      return res.status(400).json({ code: 400, message: 'device_id 和 command 不能为空' });
    }

    const topic = process.env.BEMFA_TOPIC_LED || 'ledControl';
    const cmdPayload = JSON.stringify({ cmd: command, value, device_id, ts: Date.now() });
    await publishControl(topic, cmdPayload);

    const db = getDb();
    db.prepare(`
      INSERT INTO control_logs (device_id, user_id, command_type, command_value, result)
      VALUES (?, ?, ?, ?, 'success')
    `).run(device_id, req.user.id, command, JSON.stringify(value));

    res.json({ code: 0, message: `指令 ${command} 已发送到 ${device_id}` });
  } catch (err) {
    res.status(500).json({ code: 500, message: '控制失败: ' + err.message });
  }
});

// GET /api/control/logs - 获取控制日志
router.get('/logs', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const logs = db.prepare(`
      SELECT cl.*, u.username 
      FROM control_logs cl
      LEFT JOIN users u ON cl.user_id = u.id
      ORDER BY cl.created_at DESC LIMIT ?
    `).all(limit);
    res.json({ code: 0, data: logs });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

module.exports = router;
