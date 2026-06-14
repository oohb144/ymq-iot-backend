/**
 * YMQ IoT 云平台 - MQTT 客户端
 * 订阅巴法云 MQTT 主题，接收 ESP8266 传感器数据
 * 发布控制指令到巴法云，下发给 ESP8266
 */
const mqtt = require('mqtt');
const { getDb } = require('./db');

let mqttClient = null;

// 事件回调注册
let onSensorDataCallback = null;
let onDeviceStatusCallback = null;

function initMqtt() {
  const server = process.env.BEMFA_MQTT_SERVER || 'mqtt://bemfa.com';
  const port = parseInt(process.env.BEMFA_MQTT_PORT || '9501');
  const clientId = process.env.BEMFA_MQTT_CLIENTID || 'ymq_backend_001';
  const username = process.env.BEMFA_MQTT_USER || '';
  const password = process.env.BEMFA_MQTT_PASS || '';

  const url = `${server}:${port}`;
  
  console.log(`[MQTT] 正在连接巴法云: ${url}`);
  console.log(`[MQTT] Client ID: ${clientId}`);

  const options = {
    clientId: clientId,
    username: username,
    password: password,
    clean: true,
    reconnectPeriod: 5000,    // 5秒重连
    connectTimeout: 30000,    // 30秒连接超时
    keepalive: 60
  };

  mqttClient = mqtt.connect(url, options);

  mqttClient.on('connect', () => {
    console.log('[MQTT] 已连接巴法云 MQTT 服务器');
    
    // 订阅传感器数据主题
    const sensorTopic = process.env.BEMFA_TOPIC_SENSOR || 'sensorData';
    mqttClient.subscribe(sensorTopic, { qos: 0 }, (err) => {
      if (err) {
        console.error(`[MQTT] 订阅 ${sensorTopic} 失败:`, err);
      } else {
        console.log(`[MQTT] 已订阅主题: ${sensorTopic}`);
      }
    });

    // 订阅 LED 控制主题（用于接收确认回复）
    const ledTopic = process.env.BEMFA_TOPIC_LED || 'ledControl';
    mqttClient.subscribe(ledTopic, { qos: 0 }, (err) => {
      if (err) {
        console.error(`[MQTT] 订阅 ${ledTopic} 失败:`, err);
      } else {
        console.log(`[MQTT] 已订阅主题: ${ledTopic}`);
      }
    });

    // 更新设备在线状态
    updateDeviceStatus('ESP8266_001', 'online');
    addDeviceLog('ESP8266_001', 'backend_connect', 'info', '后端服务已连接 MQTT');
  });

  mqttClient.on('message', (topic, message) => {
    const msgStr = message.toString();
    console.log(`[MQTT] 收到消息 - 主题: ${topic}, 内容: ${msgStr}`);

    const sensorTopic = process.env.BEMFA_TOPIC_SENSOR || 'sensorData';
    const ledTopic = process.env.BEMFA_TOPIC_LED || 'ledControl';

    if (topic === sensorTopic) {
      handleSensorData(msgStr);
    } else if (topic === ledTopic) {
      handleControlResponse(msgStr);
    }
  });

  mqttClient.on('error', (err) => {
    console.error('[MQTT] 连接错误:', err.message);
  });

  mqttClient.on('reconnect', () => {
    console.log('[MQTT] 正在重新连接...');
  });

  mqttClient.on('offline', () => {
    console.log('[MQTT] 已离线');
    updateDeviceStatus('ESP8266_001', 'offline');
  });

  mqttClient.on('close', () => {
    console.log('[MQTT] 连接已关闭');
  });

  return mqttClient;
}

/**
 * 处理传感器数据
 */
function handleSensorData(msgStr) {
  try {
    // 尝试解析 JSON
    let data;
    try {
      data = JSON.parse(msgStr);
    } catch {
      console.log('[MQTT] 非 JSON 数据，跳过:', msgStr);
      return;
    }

    // 检查是否是上线通知
    if (data.status === 'online') {
      updateDeviceStatus('ESP8266_001', 'online');
      addDeviceLog('ESP8266_001', 'device_online', 'info', '设备上线');
      if (onDeviceStatusCallback) onDeviceStatusCallback('ESP8266_001', 'online');
      return;
    }

    // 传感器数据入库
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO sensor_data (device_id, temperature, humidity, light, smoke, wind_speed, pressure)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      'ESP8266_001',
      data.temp ?? null,
      data.humi ?? null,
      data.light ?? null,
      data.smoke ?? null,
      data.wind_speed ?? null,
      data.pressure ?? null
    );

    // 更新设备最后在线时间
    db.prepare(`
      UPDATE devices SET last_seen = datetime('now', 'localtime'), status = 'online', updated_at = datetime('now', 'localtime')
      WHERE device_id = 'ESP8266_001'
    `).run();

    // 检查告警阈值
    checkAlertThresholds(data);

    console.log(`[DB] 传感器数据已入库: temp=${data.temp}, humi=${data.humi}, light=${data.light}, smoke=${data.smoke}`);

    // 触发回调
    if (onSensorDataCallback) onSensorDataCallback(data);

  } catch (err) {
    console.error('[MQTT] 处理传感器数据失败:', err);
  }
}

/**
 * 检查告警阈值
 */
function checkAlertThresholds(data) {
  const db = getDb();
  const thresholds = db.prepare('SELECT * FROM alert_thresholds WHERE enabled = 1').all();

  const sensorMap = {
    temperature: { value: data.temp, label: '温度', unit: '°C' },
    humidity: { value: data.humi, label: '湿度', unit: '%' },
    light: { value: data.light, label: '光照', unit: '' },
    smoke: { value: data.smoke, label: '烟雾', unit: '' }
  };

  for (const threshold of thresholds) {
    const sensor = sensorMap[threshold.sensor_type];
    if (!sensor || sensor.value === null || sensor.value === undefined) continue;

    let alertLevel = null;
    let description = '';

    if (threshold.max_value !== null && sensor.value > threshold.max_value) {
      alertLevel = threshold.sensor_type === 'smoke' ? 'critical' : 'warning';
      description = `${sensor.label}超过上限阈值: ${sensor.value}${sensor.unit} > ${threshold.max_value}${sensor.unit}`;
    } else if (threshold.min_value !== null && sensor.value < threshold.min_value) {
      alertLevel = 'warning';
      description = `${sensor.label}低于下限阈值: ${sensor.value}${sensor.unit} < ${threshold.min_value}${sensor.unit}`;
    }

    if (alertLevel) {
      // 避免短时间内重复告警（5分钟内同类型不重复）
      const recent = db.prepare(`
        SELECT id FROM alerts 
        WHERE device_id = 'ESP8266_001' AND type = ? AND status = 'unresolved'
        AND created_at > datetime('now', '-5 minutes', 'localtime')
      `).get(threshold.sensor_type);

      if (!recent) {
        db.prepare(`
          INSERT INTO alerts (device_id, level, type, description, value, threshold)
          VALUES ('ESP8266_001', ?, ?, ?, ?, ?)
        `).run(alertLevel, threshold.sensor_type, description, sensor.value, threshold.max_value || threshold.min_value);

        addDeviceLog('ESP8266_001', 'alert', alertLevel === 'critical' ? 'error' : 'warning', description);
        console.log(`[ALERT] 触发告警: ${description}`);
      }
    }
  }
}

/**
 * 处理控制响应
 */
function handleControlResponse(msgStr) {
  console.log('[MQTT] 收到控制响应:', msgStr);
  // 更新控制日志状态
  const db = getDb();
  db.prepare(`
    UPDATE control_logs SET result = 'success', responded_at = datetime('now', 'localtime')
    WHERE result = 'pending' AND device_id = 'ESP8266_001'
    ORDER BY created_at DESC LIMIT 1
  `).run();
}

/**
 * 发布控制指令到 MQTT
 */
function publishControl(topic, message) {
  if (!mqttClient || !mqttClient.connected) {
    console.error('[MQTT] 未连接，无法发布控制指令');
    return false;
  }

  return new Promise((resolve, reject) => {
    mqttClient.publish(topic, message, { qos: 0 }, (err) => {
      if (err) {
        console.error('[MQTT] 发布失败:', err);
        reject(err);
      } else {
        console.log(`[MQTT] 已发布到 ${topic}: ${message}`);
        resolve(true);
      }
    });
  });
}

/**
 * 更新设备状态
 */
function updateDeviceStatus(deviceId, status) {
  const db = getDb();
  db.prepare(`
    UPDATE devices SET status = ?, last_seen = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
    WHERE device_id = ?
  `).run(status, deviceId);
}

/**
 * 添加设备日志
 */
function addDeviceLog(deviceId, eventType, category, description, details = null) {
  const db = getDb();
  db.prepare(`
    INSERT INTO device_logs (device_id, event_type, event_category, description, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(deviceId, eventType, category, description, details);
}

/**
 * 注册传感器数据回调
 */
function onSensorData(callback) {
  onSensorDataCallback = callback;
}

/**
 * 注册设备状态回调
 */
function onDeviceStatus(callback) {
  onDeviceStatusCallback = callback;
}

/**
 * 获取 MQTT 客户端
 */
function getMqttClient() {
  return mqttClient;
}

module.exports = { initMqtt, publishControl, onSensorData, onDeviceStatus, getMqttClient, addDeviceLog };
