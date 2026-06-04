/**
 * Admin API routes
 * All routes except /login require valid admin session token
 */
const { pool } = require('./db');
const { adminSessions, hashPassword, generateToken, requireAdmin } = require('./adminAuth');

function registerAdminRoutes(app) {

    // ==================== Auth ====================

    // POST /api/admin/login
    app.post('/api/admin/login', async (req, res) => {
        try {
            const { username, password } = req.body;
            if (!username || !password) {
                return res.status(400).json({ error: '请输入用户名和密码' });
            }
            const pwHash = hashPassword(password);
            const [rows] = await pool.query(
                "SELECT id, username, must_change_password FROM admin_users WHERE username = ? AND password_hash = ?",
                [username, pwHash]
            );
            if (rows.length === 0) {
                return res.status(401).json({ error: '用户名或密码错误' });
            }
            const user = rows[0];
            const token = generateToken();
            adminSessions.set(token, {
                userId: user.id,
                username: user.username,
                must_change_password: !!user.must_change_password,
                createdAt: Date.now(),
                lastAccess: Date.now()
            });
            res.json({
                success: true,
                token,
                must_change_password: !!user.must_change_password
            });
        } catch (err) {
            console.error('Admin login error:', err);
            res.status(500).json({ error: '服务器错误' });
        }
    });

    // POST /api/admin/logout
    app.post('/api/admin/logout', requireAdmin, (req, res) => {
        const authHeader = req.headers.authorization;
        const token = authHeader.slice(7);
        adminSessions.delete(token);
        res.json({ success: true });
    });

    // GET /api/admin/me — verify session, return user info
    app.get('/api/admin/me', requireAdmin, (req, res) => {
        res.json({
            id: req.adminUser.userId,
            username: req.adminUser.username,
            must_change_password: req.adminUser.must_change_password
        });
    });

    // POST /api/admin/change-password
    app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
        try {
            const { old_password, new_password } = req.body;
            if (!old_password || !new_password) {
                return res.status(400).json({ error: '请填写旧密码和新密码' });
            }
            if (new_password.length < 6) {
                return res.status(400).json({ error: '新密码至少6位' });
            }
            // Verify old password
            const oldHash = hashPassword(old_password);
            const [rows] = await pool.query(
                "SELECT id FROM admin_users WHERE id = ? AND password_hash = ?",
                [req.adminUser.userId, oldHash]
            );
            if (rows.length === 0) {
                return res.status(400).json({ error: '旧密码错误' });
            }
            // Update password
            const newHash = hashPassword(new_password);
            await pool.query(
                "UPDATE admin_users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
                [newHash, req.adminUser.userId]
            );
            // Update session
            req.adminUser.must_change_password = false;
            res.json({ success: true, message: '密码修改成功' });
        } catch (err) {
            console.error('Change password error:', err);
            res.status(500).json({ error: '服务器错误' });
        }
    });

    // ==================== Exams ====================

    // GET /api/admin/exams — list all exams with question count
    app.get('/api/admin/exams', requireAdmin, async (req, res) => {
        try {
            const [rows] = await pool.query(`
                SELECT e.*, COUNT(q.id) as question_count
                FROM exams e
                LEFT JOIN questions q ON q.exam_id = e.id
                GROUP BY e.id
                ORDER BY e.created_at DESC
            `);
            res.json({
                data: rows.map(r => ({
                    ...r,
                    rate: parseFloat(r.rate) || 5.0,
                    ratenums: parseInt(r.ratenums) || 0,
                    question_count: parseInt(r.question_count) || 0
                }))
            });
        } catch (err) {
            console.error('Admin list exams error:', err);
            res.status(500).json({ error: '服务器错误' });
        }
    });

    // GET /api/admin/exams/:id — get single exam
    app.get('/api/admin/exams/:id', requireAdmin, async (req, res) => {
        try {
            const [rows] = await pool.query("SELECT * FROM exams WHERE id = ?", [req.params.id]);
            if (rows.length === 0) return res.status(404).json({ error: '题库不存在' });
            const exam = rows[0];
            exam.rate = parseFloat(exam.rate) || 5.0;
            exam.ratenums = parseInt(exam.ratenums) || 0;
            res.json({ data: exam });
        } catch (err) {
            console.error('Admin get exam error:', err);
            res.status(500).json({ error: '服务器错误' });
        }
    });

    // PUT /api/admin/exams/:id — update exam info
    app.put('/api/admin/exams/:id', requireAdmin, async (req, res) => {
        try {
            const { subject_name, uploader_name } = req.body;
            if (!subject_name || !uploader_name) {
                return res.status(400).json({ error: '科目名称和上传者不能为空' });
            }
            const [result] = await pool.query(
                "UPDATE exams SET subject_name = ?, uploader_name = ? WHERE id = ?",
                [subject_name, uploader_name, req.params.id]
            );
            if (result.affectedRows === 0) return res.status(404).json({ error: '题库不存在' });
            res.json({ success: true, message: '更新成功' });
        } catch (err) {
            console.error('Admin update exam error:', err);
            res.status(500).json({ error: '服务器错误' });
        }
    });

    // DELETE /api/admin/exams/:id — delete exam and all its questions
    app.delete('/api/admin/exams/:id', requireAdmin, async (req, res) => {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query("DELETE FROM questions WHERE exam_id = ?", [req.params.id]);
            const [result] = await conn.query("DELETE FROM exams WHERE id = ?", [req.params.id]);
            if (result.affectedRows === 0) {
                await conn.rollback();
                conn.release();
                return res.status(404).json({ error: '题库不存在' });
            }
            await conn.commit();
            res.json({ success: true, message: '题库已删除' });
        } catch (err) {
            await conn.rollback();
            console.error('Admin delete exam error:', err);
            res.status(500).json({ error: '服务器错误' });
        } finally {
            conn.release();
        }
    });

    // GET /api/admin/exams/:id/questions — list questions in an exam
    app.get('/api/admin/exams/:id/questions', requireAdmin, async (req, res) => {
        try {
            const [rows] = await pool.query(
                "SELECT * FROM questions WHERE exam_id = ? ORDER BY id ASC",
                [req.params.id]
            );
            res.json({
                data: rows.map(q => {
                    let options = q.options;
                    if (typeof options === 'string') {
                        try { options = JSON.parse(options); } catch (e) { options = []; }
                    }
                    return { ...q, options };
                })
            });
        } catch (err) {
            console.error('Admin list questions error:', err);
            res.status(500).json({ error: '服务器错误' });
        }
    });

    // ==================== Questions ====================

    // GET /api/admin/questions/:id — get single question
    app.get('/api/admin/questions/:id', requireAdmin, async (req, res) => {
        try {
            const [rows] = await pool.query("SELECT * FROM questions WHERE id = ?", [req.params.id]);
            if (rows.length === 0) return res.status(404).json({ error: '题目不存在' });
            const q = rows[0];
            if (typeof q.options === 'string') {
                try { q.options = JSON.parse(q.options); } catch (e) { q.options = []; }
            }
            res.json({ data: q });
        } catch (err) {
            console.error('Admin get question error:', err);
            res.status(500).json({ error: '服务器错误' });
        }
    });

    // PUT /api/admin/questions/:id — update question
    app.put('/api/admin/questions/:id', requireAdmin, async (req, res) => {
        try {
            const { title, options, answer, explanation, type } = req.body;
            if (!title) return res.status(400).json({ error: '题干不能为空' });
            // Validate options is valid JSON if provided
            let optionsJson = options;
            if (typeof options === 'string') {
                try { optionsJson = JSON.stringify(JSON.parse(options)); } catch (e) {
                    return res.status(400).json({ error: '选项格式错误，请输入有效的 JSON 数组' });
                }
            } else if (Array.isArray(options)) {
                optionsJson = JSON.stringify(options);
            }
            const [result] = await pool.query(
                "UPDATE questions SET title = ?, options = ?, answer = ?, explanation = ?, type = ? WHERE id = ?",
                [title, optionsJson, answer || '', explanation || '', type || '', req.params.id]
            );
            if (result.affectedRows === 0) return res.status(404).json({ error: '题目不存在' });
            res.json({ success: true, message: '题目已更新' });
        } catch (err) {
            console.error('Admin update question error:', err);
            res.status(500).json({ error: '服务器错误' });
        }
    });

    // DELETE /api/admin/questions/:id — delete a single question
    app.delete('/api/admin/questions/:id', requireAdmin, async (req, res) => {
        try {
            const [result] = await pool.query("DELETE FROM questions WHERE id = ?", [req.params.id]);
            if (result.affectedRows === 0) return res.status(404).json({ error: '题目不存在' });
            res.json({ success: true, message: '题目已删除' });
        } catch (err) {
            console.error('Admin delete question error:', err);
            res.status(500).json({ error: '服务器错误' });
        }
    });

    // ==================== Admin Accounts ====================

    // GET /api/admin/accounts — list all admin accounts
    app.get('/api/admin/accounts', requireAdmin, async (req, res) => {
        try {
            const [rows] = await pool.query(
                "SELECT id, username, must_change_password, created_at FROM admin_users ORDER BY id ASC"
            );
            res.json({ data: rows });
        } catch (err) {
            console.error('Admin list accounts error:', err);
            res.status(500).json({ error: '服务器错误' });
        }
    });

    // POST /api/admin/accounts — create a new admin account
    app.post('/api/admin/accounts', requireAdmin, async (req, res) => {
        try {
            const { username, password } = req.body;
            if (!username || !password) {
                return res.status(400).json({ error: '用户名和密码不能为空' });
            }
            if (username.length < 2) {
                return res.status(400).json({ error: '用户名至少2个字符' });
            }
            if (password.length < 6) {
                return res.status(400).json({ error: '密码至少6位' });
            }
            // Check duplicate
            const [existing] = await pool.query("SELECT id FROM admin_users WHERE username = ?", [username]);
            if (existing.length > 0) {
                return res.status(400).json({ error: '用户名已存在' });
            }
            const pwHash = hashPassword(password);
            const [result] = await pool.query(
                "INSERT INTO admin_users (username, password_hash, must_change_password) VALUES (?, ?, 1)",
                [username, pwHash]
            );
            res.json({ success: true, id: result.insertId, message: '管理员账号已创建' });
        } catch (err) {
            console.error('Admin create account error:', err);
            res.status(500).json({ error: '服务器错误' });
        }
    });

    // DELETE /api/admin/accounts/:id — delete an admin account
    app.delete('/api/admin/accounts/:id', requireAdmin, async (req, res) => {
        try {
            const targetId = parseInt(req.params.id);
            if (targetId === req.adminUser.userId) {
                return res.status(400).json({ error: '不能删除自己的账号' });
            }
            const [result] = await pool.query("DELETE FROM admin_users WHERE id = ?", [targetId]);
            if (result.affectedRows === 0) return res.status(404).json({ error: '账号不存在' });
            res.json({ success: true, message: '账号已删除' });
        } catch (err) {
            console.error('Admin delete account error:', err);
            res.status(500).json({ error: '服务器错误' });
        }
    });

    // POST /api/admin/accounts/:id/reset-password — reset another admin's password
    app.post('/api/admin/accounts/:id/reset-password', requireAdmin, async (req, res) => {
        try {
            const { new_password } = req.body;
            if (!new_password || new_password.length < 6) {
                return res.status(400).json({ error: '新密码至少6位' });
            }
            const newHash = hashPassword(new_password);
            const [result] = await pool.query(
                "UPDATE admin_users SET password_hash = ?, must_change_password = 1 WHERE id = ?",
                [newHash, req.params.id]
            );
            if (result.affectedRows === 0) return res.status(404).json({ error: '账号不存在' });
            res.json({ success: true, message: '密码已重置' });
        } catch (err) {
            console.error('Admin reset password error:', err);
            res.status(500).json({ error: '服务器错误' });
        }
    });

    console.log('✓ 管理员路由已注册');
}

module.exports = { registerAdminRoutes };
