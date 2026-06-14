/**
 * 用户认证路由 - 登录/注册/用户管理
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { JWT_SECRET, authMiddleware } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login - 用户登录
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ code: 400, message: '邮箱和密码不能为空' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ code: 401, message: '邮箱或密码错误' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ code: 401, message: '邮箱或密码错误' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      code: 0,
      message: '登录成功',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          avatar_initial: user.avatar_initial,
          level: user.level
        }
      }
    });
  } catch (err) {
    console.error('[AUTH] 登录失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// POST /api/auth/register - 用户注册
router.post('/register', (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ code: 400, message: '用户名、邮箱和密码不能为空' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (existing) {
      return res.status(409).json({ code: 409, message: '邮箱或用户名已存在' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const avatarInitial = username.charAt(0);
    
    const result = db.prepare(`
      INSERT INTO users (username, email, password_hash, avatar_initial)
      VALUES (?, ?, ?, ?)
    `).run(username, email, hash, avatarInitial);

    res.json({ code: 0, message: '注册成功', data: { id: result.lastInsertRowid } });
  } catch (err) {
    console.error('[AUTH] 注册失败:', err);
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// GET /api/auth/me - 获取当前用户信息
router.get('/me', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare(`
      SELECT id, username, email, role, avatar_initial, level, 
             total_training_count, total_training_hours, avg_accuracy, last_training_date, created_at
      FROM users WHERE id = ?
    `).get(req.user.id);

    if (!user) return res.status(404).json({ code: 404, message: '用户不存在' });
    res.json({ code: 0, data: user });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// GET /api/auth/users - 获取所有用户列表（管理员）
router.get('/users', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const users = db.prepare(`
      SELECT id, username, email, role, avatar_initial, level,
             total_training_count, total_training_hours, avg_accuracy, last_training_date, created_at
      FROM users ORDER BY created_at DESC
    `).all();

    res.json({ code: 0, data: users });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// PUT /api/auth/users/:id - 更新用户信息
router.put('/users/:id', authMiddleware, (req, res) => {
  try {
    const { username, email, role, level } = req.body;
    const db = getDb();
    
    db.prepare(`
      UPDATE users SET 
        username = COALESCE(?, username),
        email = COALESCE(?, email),
        role = COALESCE(?, role),
        level = COALESCE(?, level),
        updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(username, email, role, level, req.params.id);

    res.json({ code: 0, message: '更新成功' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

// DELETE /api/auth/users/:id - 删除用户
router.delete('/users/:id', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ code: 403, message: '仅管理员可删除用户' });
    }
    const db = getDb();
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ code: 0, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ code: 500, message: '服务器错误' });
  }
});

module.exports = router;
