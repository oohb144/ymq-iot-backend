# YMQ IoT Cloud Platform - Backend

基于 Node.js + Express + MQTT + SQLite 的智能羽毛球陪练系统后端服务器。

## 技术栈

- **Runtime**: Node.js
- **Framework**: Express
- **Database**: sql.js (纯 JS SQLite)
- **MQTT**: 巴法云 (bemfa.com)
- **Auth**: JWT + bcrypt

## 快速部署

### Railway 一键部署

1. 打开 [Railway](https://railway.app) 并用 GitHub 登录
2. 点击 **New Project** → **Deploy from GitHub repo**
3. 选择 `oohb144/ymq-iot-backend`
4. 在 **Variables** 中添加以下环境变量：

| 变量名 | 值 |
|--------|-----|
| BEMFA_UID | 89668fa0fd25499c92e12066458435ad |
| BEMFA_MQTT_SERVER | mqtt://bemfa.com |
| BEMFA_MQTT_PORT | 9501 |
| BEMFA_MQTT_CLIENTID | ymq_backend_001 |
| BEMFA_MQTT_USER | beid_2kDM0UjMxgzNx8lNwYTM2MD |
| BEMFA_MQTT_PASS | 8b8j4d66w80252r3auUjJaikx1A8AoEa |
| BEMFA_TOPIC_SENSOR | sensorData |
| BEMFA_TOPIC_LED | ledControl |
| BEMFA_API_BASE | https://apis.bemfa.com |
| JWT_SECRET | ymq_iot_cloud_2026_secret_key |
| PORT | 3000 |

5. Railway 会自动部署，完成后会给你一个 URL（如 `ymq-iot-backend.up.railway.app`）

## API 端点

- `GET /api/health` - 健康检查
- `GET /api/dashboard` - 控制台概览
- `POST /api/auth/login` - 用户登录
- `GET /api/sensors/latest` - 最新传感器数据
- `GET /api/sensors/history` - 历史数据
- `GET /api/sensors/export` - CSV 导出
- `GET /api/devices` - 设备列表
- `POST /api/control/led` - LED 控制
- `POST /api/control/training/mode` - 训练模式切换
- `POST /api/control/training/action` - 训练控制
- `POST /api/control/training/params` - 训练参数下发
- `GET /api/alerts` - 告警列表
- `GET /api/settings` - 系统设置

## 本地运行

```bash
npm install
node index.js
```

服务器启动在 http://localhost:3000
