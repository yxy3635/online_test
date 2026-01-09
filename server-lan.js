const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const child_process = require('child_process');
const { parseWordToQuestions } = require('./lib/wordParser');
const { parseWithAI, askAIForExplanation } = require('./lib/aiParser');  
const { pool, initDB } = require('./lib/db');
const mammoth = require('mammoth');  

const app = express();
const port = 3000;

const onlineUsers = new Map();  
const HEARTBEAT_INTERVAL = 5000;  
const USER_TIMEOUT = 15000;  

setInterval(async () => {
    const now = Date.now();
    let activeCount = 0;
    for (const [id, lastTime] of onlineUsers.entries()) {
        if (now - lastTime > USER_TIMEOUT) {
            onlineUsers.delete(id);
        } else {
            activeCount++;
        }
    }
    
}, HEARTBEAT_INTERVAL);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const backgroundStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const customName = req.body.name || file.originalname;
        const safeName = customName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const ext = path.extname(file.originalname);
        const nameWithoutExt = path.basename(safeName, ext);
        cb(null, nameWithoutExt + ext);
    }
});
const backgroundUpload = multer({ 
    storage: backgroundStorage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error('只支持图片格式：jpeg, jpg, png, gif, webp'));
        }
    },
    limits: { fileSize: 64 * 1024 * 1024 }
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

initDB();

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('已创建 uploads 目录:', uploadsDir);
} else {
    console.log('uploads 目录已存在:', uploadsDir);
    try {
        const files = fs.readdirSync(uploadsDir);
        console.log('uploads 目录中的文件:', files);
    } catch (e) {
        console.error('读取 uploads 目录失败:', e);
    }
}

app.post('/api/heartbeat', (req, res) => {
    const userId = req.body.userId || req.ip;
    onlineUsers.set(userId, Date.now());
    res.json({ success: true });
});

app.get('/api/stats', async (req, res) => {
    try {
        const [statsRows] = await pool.query('SELECT total_usage_seconds FROM system_stats WHERE id = 1');
        const [questionRows] = await pool.query('SELECT COUNT(*) as count FROM questions');

        const readText = (p) => {
            try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; }
        };

        const fmtGB1 = (bytesBig) => {
            try {
                const bytes = BigInt(bytesBig);
                if (bytes <= 0n) return '0.0';
                const tenths = (bytes * 10n) / 1073741824n; // 1024^3
                const i = tenths / 10n;
                const d = tenths % 10n;
                return `${i}.${d}`;
            } catch {
                return '0.0';
            }
        };

        const fmtPct1 = (usedBig, totalBig) => {
            try {
                const used = BigInt(usedBig);
                const total = BigInt(totalBig);
                if (total <= 0n) return '0.0';
                const tenths = (used * 1000n) / total;  
                const i = tenths / 10n;
                const d = tenths % 10n;
                return `${i}.${d}`;
            } catch {
                return '0.0';
            }
        };

        const getCgroupMemory = () => {
            if (process.platform !== 'linux') return null;

            if (fs.existsSync('/sys/fs/cgroup/cgroup.controllers')) {
                const maxStr = readText('/sys/fs/cgroup/memory.max');
                const curStr = readText('/sys/fs/cgroup/memory.current');
                if (maxStr && curStr && maxStr !== 'max') {
                    try { return { totalBytes: BigInt(maxStr), usedBytes: BigInt(curStr) }; } catch {}
                }
            }

            const limStr = readText('/sys/fs/cgroup/memory/memory.limit_in_bytes');
            const useStr = readText('/sys/fs/cgroup/memory/memory.usage_in_bytes');
            if (limStr && useStr) {
                try {
                    const total = BigInt(limStr);
                    const used = BigInt(useStr);
                    const osTotal = BigInt(os.totalmem());
                    if (total > osTotal * 2n) return null;
                    return { totalBytes: total, usedBytes: used };
                } catch {}
            }

            return null;
        };

        const memFromCgroup = getCgroupMemory();
        const memTotalBytes = memFromCgroup ? memFromCgroup.totalBytes : BigInt(os.totalmem());
        const memUsedBytes = memFromCgroup ? memFromCgroup.usedBytes : (BigInt(os.totalmem()) - BigInt(os.freemem()));

        const getDiskBytes = () => {
            if (typeof fs.statfsSync === 'function') {
                try {
                    let st;
                    try { st = fs.statfsSync('.'); } catch { st = fs.statfsSync('/'); }
                    const bSize = BigInt(st.frsize || st.bsize || 4096);
                    const blocks = BigInt(st.blocks || 0);
                    const bavail = BigInt(st.bavail || st.bfree || 0);
                    return { totalBytes: blocks * bSize, freeBytes: bavail * bSize };
                } catch {}
            }

            if (process.platform === 'linux') {
                try {
                    const out = child_process.execSync('df -kP /', { encoding: 'utf8' }).trim().split('\n');
                    if (out.length >= 2) {
                        const parts = out[1].replace(/\s+/g, ' ').split(' ');
                        const totalKB = BigInt(parts[1] || '0');
                        const availKB = BigInt(parts[3] || '0');
                        return { totalBytes: totalKB * 1024n, freeBytes: availKB * 1024n };
                    }
                } catch {}
            }

            return { totalBytes: 0n, freeBytes: 0n };
        };

        const disk = getDiskBytes();
        const diskTotalBytes = disk.totalBytes;
        const diskFreeBytes = disk.freeBytes;
        const diskUsedBytes = diskTotalBytes > 0n ? (diskTotalBytes - diskFreeBytes) : 0n;

        const storageInfo = {
            total: fmtGB1(diskTotalBytes),
            free: fmtGB1(diskFreeBytes),
            usage: fmtPct1(diskUsedBytes, diskTotalBytes)
        };
        
        const [uploaderRows] = await pool.query(`
            SELECT uploader_name, COUNT(*) as exam_count 
            FROM exams 
            WHERE uploader_name IS NOT NULL AND TRIM(uploader_name) != '' AND uploader_name != '匿名'
            GROUP BY uploader_name 
            ORDER BY exam_count DESC 
            LIMIT 1
        `);
        
        let topUploader = uploaderRows[0];
        
        if (!topUploader) {
            const [allRows] = await pool.query(`
                SELECT uploader_name, COUNT(*) as exam_count 
                FROM exams 
                GROUP BY uploader_name 
                ORDER BY exam_count DESC 
                LIMIT 1
            `);
            topUploader = allRows[0] || { uploader_name: '系统', exam_count: 0 };
        }

        res.json({
            totalUsageSeconds: statsRows[0]?.total_usage_seconds || 0,
            totalQuestions: questionRows[0]?.count || 0,
            onlineUsers: onlineUsers.size,
            topUploader: {
                uploader_name: topUploader.uploader_name || '未知贡献者',
                exam_count: topUploader.exam_count || 0
            },
            serverInfo: {
                memory: {
                    total: fmtGB1(memTotalBytes),
                    usage: fmtPct1(memUsedBytes, memTotalBytes)
                },
                storage: storageInfo,
                region: process.env.SERVER_REGION || '中国 · 成都'
            }
        });
    } catch (error) {
        console.error('获取统计数据失败:', error);
        res.status(500).json({ error: '获取统计数据失败' });
    }
});

app.get('/api/exams', async (req, res) => {
    try {
        const sql = `
            SELECT e.*, COUNT(q.id) as question_count 
            FROM exams e 
            LEFT JOIN questions q ON e.id = q.exam_id 
            GROUP BY e.id 
            ORDER BY e.created_at DESC
        `;
        const [rows] = await pool.query(sql);
        const formattedRows = rows.map(row => ({
            ...row,
            rate: row.rate !== null && row.rate !== undefined ? parseFloat(row.rate) : 5.0,
            ratenums: row.ratenums !== null && row.ratenums !== undefined ? parseInt(row.ratenums) : 0
        }));
        res.json({ data: formattedRows });
    } catch (error) {
        console.error('获取试卷列表失败:', error);
        res.status(500).json({ error: '数据库查询失败' });
    }
});

async function saveExamToDB(subject, uploader, questions) {
    if (questions.length === 0) {
        return { success: false, message: '未识别到有效题目' };
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [examResult] = await connection.query(
            'INSERT INTO exams (subject_name, uploader_name) VALUES (?, ?)',
            [subject, uploader]
        );
        const examId = examResult.insertId;

        const questionSql = `
            INSERT INTO questions (exam_id, title, options, answer, explanation, type) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        for (const q of questions) {
            await connection.query(questionSql, [
                examId,
                q.title, 
                JSON.stringify(q.options || []),
                q.answer,
                q.explanation || '',
                q.type || '未知'
            ]);
        }

        await connection.commit();
        console.log(`成功创建试卷 ID=${examId}, 包含 ${questions.length} 题`);
        return { success: true, examId, count: questions.length };

    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

// 预览接口（只解析不保存）
app.post('/api/upload/preview', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请上传文件' });
    if (!req.file.originalname.endsWith('.docx')) return res.status(400).json({ error: '仅支持 .docx 格式' });

    try {
        console.log(`[预览模式] 解析文件...`);
        
        const questions = await parseWordToQuestions(req.file.buffer);
        
        res.json({ 
            success: true,
            count: questions.length, 
            questions: questions 
        });

    } catch (error) {
        console.error('预览解析失败:', error);
        res.status(500).json({ error: '处理失败', details: error.message });
    }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请上传文件' });
    if (!req.file.originalname.endsWith('.docx')) return res.status(400).json({ error: '仅支持 .docx 格式' });
    
    const uploader = req.body.uploader || '匿名';
    const subject = req.body.subject || '未命名科目';

    try {
        console.log(`[正则模式] 处理上传: [${subject}] by ${uploader}`);
        
        const questions = await parseWordToQuestions(req.file.buffer);
        
        const result = await saveExamToDB(subject, uploader, questions);
        if (!result.success) return res.json({ message: result.message, count: 0 });

        res.json({ message: '上传成功', examId: result.examId, count: result.count });

    } catch (error) {
        console.error('正则上传失败:', error);
        res.status(500).json({ error: '处理失败', details: error.message });
    }
});

// AI预览接口（只解析不保存）
app.post('/api/upload/ai/preview', upload.single('file'), async (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    if (!req.file) {
        res.write(JSON.stringify({ error: '请上传文件' }));
        return res.end();
    }

    const sendProgress = (percent, message) => {
        const data = JSON.stringify({ type: 'progress', percent, message });
        res.write(data + '\n');
    };

    try {
        console.log(`[AI 预览模式] 解析文件...`);
        sendProgress(0, '正在提取文档文本...');
        
        const rawResult = await mammoth.extractRawText({ buffer: req.file.buffer });
        let fullText = rawResult.value;

        if (!fullText) {
             throw new Error('文档内容为空');
        }
        
        sendProgress(10, `文本提取成功 (${fullText.length} 字符)，准备 AI 深度解析...`);

        const questions = await parseWithAI(fullText, (percent, msg) => {
            const mappedPercent = 10 + Math.round(percent * 0.85);
            sendProgress(mappedPercent, msg);
        });
        
        sendProgress(95, 'AI 解析完成');
        res.write(JSON.stringify({
            type: 'complete',
            success: true,
            count: questions.length,
            questions: questions
        }) + '\n');

    } catch (error) {
        console.error('AI 预览失败:', error);
        res.write(JSON.stringify({ type: 'error', message: '服务器内部错误: ' + error.message }) + '\n');
    } finally {
        res.end();
    }
});

app.post('/api/upload/ai', upload.single('file'), async (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    if (!req.file) {
        res.write(JSON.stringify({ error: '请上传文件' }));
        return res.end();
    }
    
    const uploader = req.body.uploader || '匿名';
    const subject = req.body.subject || '未命名科目';

    const sendProgress = (percent, message) => {
        const data = JSON.stringify({ type: 'progress', percent, message });
        res.write(data + '\n');
    };

    try {
        console.log(`[AI 模式] 处理上传: [${subject}] by ${uploader}`);
        sendProgress(0, '正在提取文档文本...');
        
        const rawResult = await mammoth.extractRawText({ buffer: req.file.buffer });
        let fullText = rawResult.value;

        if (!fullText) {
             throw new Error('文档内容为空');
        }
        
        sendProgress(10, `文本提取成功 (${fullText.length} 字符)，准备 AI 深度解析...`);

        const questions = await parseWithAI(fullText, (percent, msg) => {
            const mappedPercent = 10 + Math.round(percent * 0.85);
            sendProgress(mappedPercent, msg);
        });
        
        sendProgress(95, 'AI 解析完成，正在写入数据库...');
        const result = await saveExamToDB(subject, uploader, questions);
        
        if (!result.success) {
            res.write(JSON.stringify({ type: 'error', message: result.message }));
        } else {
            res.write(JSON.stringify({
                type: 'complete',
                message: '上传处理完成',
                examId: result.examId,
                count: result.count
            }) + '\n');
        }

    } catch (error) {
        console.error('AI 上传失败:', error);
        res.write(JSON.stringify({ type: 'error', message: '服务器内部错误: ' + error.message }) + '\n');
    } finally {
        res.end();
    }
});

app.get('/api/questions', async (req, res) => {
    const examId = req.query.exam_id;

    if (!examId) {
        return res.json({ count: 0, data: [], message: "请提供 exam_id 参数" });
    }

    try {
        const [rows] = await pool.query('SELECT * FROM questions WHERE exam_id = ? ORDER BY id ASC', [examId]);
        
        const formattedQuestions = rows.map(row => ({
            ...row,
            options: typeof row.options === 'string' ? JSON.parse(row.options) : row.options
        }));

        res.json({
            count: formattedQuestions.length,
            data: formattedQuestions
        });
    } catch (error) {
        console.error('获取题目失败:', error);
        res.status(500).json({ error: '数据库查询失败' });
    }
});

app.post('/api/upload/json', async (req, res) => {
    const uploader = req.body?.uploader || '匿名';
    const subject = req.body?.subject || '未命名科目';
    const incoming = req.body?.questions ?? req.body;

    const questions = Array.isArray(incoming) ? incoming : (incoming?.questions || []);

    if (!Array.isArray(questions)) {
        return res.status(400).json({ error: '无效的 JSON：需要 questions 数组或直接传数组' });
    }
    if (questions.length === 0) {
        return res.status(400).json({ error: '题目列表为空' });
    }

    try {
        const normalized = questions.map(q => ({
            title: String(q?.title ?? '').trim(),
            type: q?.type || '未知',
            options: Array.isArray(q?.options) ? q.options : [],
            answer: q?.answer ?? '',
            explanation: q?.explanation ?? ''
        }));

        const invalidIndex = normalized.findIndex(q => !q.title);
        if (invalidIndex !== -1) {
            return res.status(400).json({ error: `第 ${invalidIndex + 1} 题缺少 title（题干）` });
        }

        const result = await saveExamToDB(subject, uploader, normalized);
        if (!result.success) return res.status(500).json({ error: result.message });

        return res.json({ message: '导入成功', examId: result.examId, count: result.count });
    } catch (error) {
        console.error('JSON 导入失败:', error);
        return res.status(500).json({ error: '处理失败: ' + error.message });
    }
});

app.post('/api/ask-ai', async (req, res) => {
    const { question, userAnswer } = req.body;
    
    if (!question) return res.status(400).json({ error: '缺少题目数据' });

    try {
        const reply = await askAIForExplanation({ ...question, userAnswer });
        res.json({ reply });
    } catch (error) {
        console.error('AI 解析失败:', error);
        res.status(500).json({ error: 'AI 服务暂时不可用: ' + error.message });
    }
});

app.post('/api/upload/background', backgroundUpload.single('background'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '请上传图片文件' });
    }
    
    const filename = req.file.filename;
    res.json({ 
        success: true, 
        filename: filename,
        url: `/uploads/${filename}`
    });
});

app.post('/api/exam/rate', async (req, res) => {
    try {
        const { exam_id, rating, user_token } = req.body;

        if (!exam_id || !rating || !user_token) {
            return res.status(400).json({ error: '缺少必要参数：exam_id、rating 和 user_token' });
        }

        const ratingNum = parseFloat(rating);
        if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
            return res.status(400).json({ error: '评分必须在 1-5 之间' });
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [examRows] = await connection.query('SELECT id, rate, ratenums FROM exams WHERE id = ?', [exam_id]);
            
            if (examRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: '试卷不存在' });
            }

            const oldRate = examRows[0].rate !== null && examRows[0].rate !== undefined ? parseFloat(examRows[0].rate) : 5.0;
            const oldNums = examRows[0].ratenums !== null && examRows[0].ratenums !== undefined ? parseInt(examRows[0].ratenums) : 0;

            const newNums = oldNums + 1;
            const newRate = ((oldRate * oldNums) + ratingNum) / newNums;
            const roundedAvg = Math.round(newRate * 10) / 10;

            try {
                await connection.query(
                    'UPDATE exams SET rate = ?, ratenums = ? WHERE id = ?',
                    [roundedAvg, newNums, exam_id]
                );
            } catch (e) {
                if (e.message.includes("Unknown column 'ratenums'")) {
                    await connection.query(
                        'UPDATE exams SET rate = ? WHERE id = ?',
                        [roundedAvg, exam_id]
                    );
                    console.warn('ratenums字段不存在，只更新了rate字段。请重启服务器以初始化数据库字段。');
                } else {
                    throw e;
                }
            }

            await connection.commit();

            res.json({
                success: true,
                rate: roundedAvg,
                count: newNums
            });

        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }

    } catch (error) {
        console.error('提交评分失败:', error);
        res.status(500).json({ error: '提交评分失败: ' + error.message });
    }
});

app.get('/api/backgrounds', (req, res) => {
    try {
        const uploadsDirPath = path.join(__dirname, 'uploads');
        console.log('[背景列表API] 读取背景目录:', uploadsDirPath);

        if (!fs.existsSync(uploadsDirPath)) {
            console.error('[背景列表API] uploads目录不存在:', uploadsDirPath);
            return res.json({ data: [] });
        }

        const files = fs.readdirSync(uploadsDirPath);
        console.log('[背景列表API] 目录中的所有文件:', files);

        const imageFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
            if (!isImage) {
                console.log(`[背景列表API] 跳过非图片文件: ${file} (扩展名: ${ext})`);
            } else {
                const filePath = path.join(uploadsDirPath, file);
                if (!fs.existsSync(filePath)) {
                    console.warn(`[背景列表API] 文件不存在: ${filePath}`);
                    return false;
                }
            }
            return isImage;
        });
        
        console.log('[背景列表API] 过滤后的图片文件:', imageFiles);

        const page = parseInt(req.query.page) || 1;
        const pageSize = parseInt(req.query.pageSize) || 20;
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;

        const paginatedFiles = imageFiles.slice(startIndex, endIndex);
        
        const backgrounds = paginatedFiles.map(file => ({
            name: file,
            url: `/uploads/${file}`
        }));

        const total = imageFiles.length;
        const hasMore = endIndex < total;
        
        console.log(`[背景列表API] 返回第 ${page} 页，共 ${total} 个背景，本页 ${backgrounds.length} 个`);
        res.json({ 
            data: backgrounds,
            total: total,
            page: page,
            pageSize: pageSize,
            hasMore: hasMore
        });
    } catch (error) {
        console.error('[背景列表API] 获取背景列表失败:', error);
        res.status(500).json({ error: '获取背景列表失败: ' + error.message });
    }
});

// 获取所有可用的 IP 地址
function getAllIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                const addr = iface.address;
                // 判断是否为真正的局域网 IP（排除 VPN 和虚拟网卡）
                const isLAN = (addr.startsWith('192.168.') && !name.toLowerCase().includes('vmware') && !name.toLowerCase().includes('virtual')) || 
                             (addr.startsWith('10.') && !name.toLowerCase().includes('vpn') && !name.toLowerCase().includes('radmin')) ||
                             (addr.startsWith('172.16.') || addr.startsWith('172.17.') || addr.startsWith('172.18.') || 
                              addr.startsWith('172.19.') || addr.startsWith('172.20.') || addr.startsWith('172.21.') ||
                              addr.startsWith('172.22.') || addr.startsWith('172.23.') || addr.startsWith('172.24.') ||
                              addr.startsWith('172.25.') || addr.startsWith('172.26.') || addr.startsWith('172.27.') ||
                              addr.startsWith('172.28.') || addr.startsWith('172.29.') || addr.startsWith('172.30.') ||
                              addr.startsWith('172.31.'));
                
                ips.push({
                    name: name,
                    address: addr,
                    isLAN: isLAN,
                    isVPN: name.toLowerCase().includes('vpn') || name.toLowerCase().includes('radmin'),
                    isVirtual: name.toLowerCase().includes('vmware') || name.toLowerCase().includes('virtual')
                });
            }
        }
    }
    return ips;
}

// 获取首选局域网 IP（优先选择真正的局域网 IP，排除 VPN 和虚拟网卡）
function getPreferredIP() {
    const ips = getAllIPs();
    
    // 优先选择真正的局域网 IP（排除 VPN 和虚拟网卡）
    const lanIP = ips.find(ip => ip.isLAN && !ip.isVPN && !ip.isVirtual);
    if (lanIP) {
        return lanIP.address;
    }
    
    // 其次选择局域网 IP（即使可能是虚拟的）
    const anyLanIP = ips.find(ip => ip.isLAN);
    if (anyLanIP) {
        return anyLanIP.address;
    }
    
    // 最后选择第一个非内部 IP
    if (ips.length > 0) {
        return ips[0].address;
    }
    
    return 'localhost';
}

const allIPs = getAllIPs();
const preferredIP = getPreferredIP();

app.listen(port, '0.0.0.0', () => {
    console.log('\n========================================');
    console.log('在线答题系统已启动（局域网模式）！');
    console.log('========================================');
    console.log(`本机访问: http://localhost:${port}`);
    console.log('\n可用的网络接口：');
    
    if (allIPs.length === 0) {
        console.log('  ⚠️  未找到可用的网络接口');
    } else {
        allIPs.forEach((ip, index) => {
            const isPreferred = ip.address === preferredIP;
            const marker = isPreferred ? '⭐ (推荐)' : '';
            const type = ip.isLAN ? '[局域网]' : '[其他]';
            console.log(`  ${index + 1}. ${ip.name}: ${ip.address} ${type} ${marker}`);
        });
    }
    
    console.log(`\n首选访问地址: http://${preferredIP}:${port}`);
    console.log('========================================');
    console.log('⚠️  重要提示：');
    console.log('1. 确保 Windows 防火墙已允许端口 ' + port + ' 的访问');
    console.log('   方法：Windows 设置 > 隐私和安全性 > Windows 安全中心 > 防火墙和网络保护');
    console.log('   或运行命令：netsh advfirewall firewall add rule name="Node.js Server" dir=in action=allow protocol=TCP localport=' + port);
    console.log('2. 如果无法访问，请尝试使用其他网络接口的 IP 地址');
    console.log('3. 在同一局域网内的其他设备上使用上述 IP 地址访问');
    console.log('4. 确保服务器和客户端在同一局域网内（不是 VPN 网络）');
    console.log('========================================\n');
});

