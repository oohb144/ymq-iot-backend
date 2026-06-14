/**
 * YMQ IoT 云平台 - 后端服务器入口
 * 
 * 技术栈: Node.js + Express + SQLite + MQTT
 * 功能: REST API + MQTT 订阅 + 数据存储 + 设备控制
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const { initDatabase } = require('./db');
const { initMqtt, onSensorData, onDeviceStatus } = require('./mqtt');

// 路由
const authRouter = require('./routes/auth');
const sensorsRouter = require('./routes/sensors');
const controlRouter = require('./routes/control');
const alertsRouter = require('./routes/alerts');
const devicesRouter = require('./routes/devices');
const trainingRouter = require('./routes/training');
const settingsRouter = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 请求日志
app.use((req, res, next) => {
  const now = new Date().toISOString();
  console.log(`[${now}] ${req.method} ${req.path}`);
  next();
});

// ==================== API 路由 ====================

app.use('/api/auth', authRouter);
app.use('/api/sensors', sensorsRouter);
app.use('/api/control', controlRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/training', trainingRouter);
app.use('/api/settings', settingsRouter);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    code: 0,
    message: 'YMQ IoT Backend is running',
    data: {
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      mqtt_connected: require('./mqtt').getMqttClient()?.connected || false
    }
  });
});

// Dashboard 统计概览 (控制台页面用)
app.get('/api/dashboard', (req, res) => {
  try {
    const db = require('./db').getDb();

    const onlineDevices = db.prepare(
      "SELECT COUNT(*) as count FROM devices WHERE status = 'online'"
    ).get();
    
    const totalDevices = db.prepare(
      "SELECT COUNT(*) as count FROM devices"
    ).get();

    const todayTraining = db.prepare(`
      SELECT COALESCE(SUM(duration_minutes), 0) / 60.0 as hours 
      FROM training_records 
      WHERE status = 'completed' AND date(created_at) = date('now', 'localtime')
    `).get();

    const totalServings = db.prepare(
      "SELECT COALESCE(SUM(serving_count), 0) as count FROM training_records"
    ).get();

    const avgAccuracy = db.prepare(
      "SELECT COALESCE(AVG(accuracy), 0) as avg FROM training_records WHERE accuracy > 0"
    ).get();

    const unresolvedAlerts = db.prepare(
      "SELECT COUNT(*) as count FROM alerts WHERE status = 'unresolved'"
    ).get();

    const latestSensor = db.prepare(`
      SELECT * FROM sensor_data ORDER BY timestamp DESC LIMIT 1
    `).get();

    const recentAlerts = db.prepare(`
      SELECT a.*, d.name as device_name 
      FROM alerts a LEFT JOIN devices d ON a.device_id = d.device_id
      ORDER BY a.created_at DESC LIMIT 5
    `).all();

    // 今日训练次数
    const todaySessions = db.prepare(`
      SELECT COUNT(*) as count FROM training_records
      WHERE date(created_at) = date('now', 'localtime')
    `).get();

    res.json({
      code: 0,
      data: {
        online_devices: onlineDevices.count,
        total_devices: totalDevices.count,
        today_training_hours: Math.round(todayTraining.hours * 10) / 10,
        today_sessions: todaySessions.count,
        total_servings: totalServings.count,
        avg_accuracy: Math.round(avgAccuracy.avg),
        unresolved_alerts: unresolvedAlerts.count,
        latest_sensor: latestSensor || null,
        recent_alerts: recentAlerts
      }
    });
  } catch (err) {
    console.error('[DASHBOARD] 获取概览数据失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// System status
app.get('/api/system/status', (req, res) => {
  try {
    const db = require('./db').getDb();
    const sensorCount = db.prepare('SELECT COUNT(*) as count FROM sensor_data').get();
    const trainingCount = db.prepare('SELECT COUNT(*) as count FROM training_records').get();
    const deviceCount = db.prepare('SELECT COUNT(*) as count FROM devices').get();
    const onlineCount = db.prepare("SELECT COUNT(*) as count FROM devices WHERE status = 'online'").get();
    
    res.json({
      code: 0,
      data: {
        uptime_seconds: Math.floor(process.uptime()),
        total_sensor_records: sensorCount.count,
        total_training_records: trainingCount.count,
        total_devices: deviceCount.count,
        online_devices: onlineCount.count,
        mqtt_connected: require('./mqtt').getMqttClient()?.connected || false,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// 404 处理
app.use((req, res) => {
  res.status(404).json({ code: 404, message: `路由不存在: ${req.method} ${req.path}` });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ code: 500, message: '服务器内部错误' });
});

// ==================== 启动服务器 ====================

console.log('============================================');
console.log('  YMQ IoT 云平台 - 后端服务器');
console.log('============================================');

async function startServer() {
  // 1. 初始化数据库（async，必须先完成）
  console.log('[INIT] 正在初始化数据库...');
  await initDatabase();
  console.log('[INIT] 数据库初始化完成');

  // 2. 初始化 MQTT
  console.log('[INIT] 正在连接 MQTT...');
  initMqtt();

  // 3. 注册实时数据回调
  onSensorData((data) => {
    console.log(`[REALTIME] 新传感器数据: temp=${data.temp}, humi=${data.humi}`);
  });

  onDeviceStatus((deviceId, status) => {
    console.log(`[REALTIME] 设备状态变更: ${deviceId} -> ${status}`);
  });

  // 4. 启动 HTTP 服务器
  app.listen(PORT, () => {
    console.log(`[INIT] 后端服务器已启动: http://localhost:${PORT}`);
    console.log(`[INIT] API 文档: http://localhost:${PORT}/api/health`);
    console.log('============================================');
  });
}

startServer().catch((err) => {
  console.error('[FATAL] 启动失败:', err);
  process.exit(1);
});
