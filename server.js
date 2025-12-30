const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { parseWordToQuestions } = require('./lib/wordParser');
const { parseWithAI, askAIForExplanation } = require('./lib/aiParser'); // 引入 AI 解析器
const { pool, initDB } = require('./lib/db');
const mammoth = require('mammoth'); // 用于 AI 接口提取文本

const app = express();
const port = 3000;

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

/**
 * API: 获取所有试卷列表 (用于首页展示)
 * 返回：[{ id, subject_name, uploader_name, question_count, created_at }, ...]
 */
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
        res.json({ data: rows });
    } catch (error) {
        console.error('获取试卷列表失败:', error);
        res.status(500).json({ error: '数据库查询失败' });
    }
});

/**
 * 通用入库逻辑
 */
async function saveExamToDB(subject, uploader, questions) {
    if (questions.length === 0) {
        return { success: false, message: '未识别到有效题目' };
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // 1. 插入 exams 表
        const [examResult] = await connection.query(
            'INSERT INTO exams (subject_name, uploader_name) VALUES (?, ?)',
            [subject, uploader]
        );
        const examId = examResult.insertId;

        // 2. 插入 questions 表
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

/**
 * API: 普通上传 (正则解析)
 */
app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请上传文件' });
    if (!req.file.originalname.endsWith('.docx')) return res.status(400).json({ error: '仅支持 .docx 格式' });
    
    const uploader = req.body.uploader || '匿名';
    const subject = req.body.subject || '未命名科目';

    try {
        console.log(`[正则模式] 处理上传: [${subject}] by ${uploader}`);
        
        // 解析 Word
        const questions = await parseWordToQuestions(req.file.buffer);
        
        // 入库
        const result = await saveExamToDB(subject, uploader, questions);
        if (!result.success) return res.json({ message: result.message, count: 0 });

        res.json({ message: '上传成功', examId: result.examId, count: result.count });

    } catch (error) {
        console.error('正则上传失败:', error);
        res.status(500).json({ error: '处理失败', details: error.message });
    }
});

/**
 * API: AI 上传 (AI 解析) - 支持流式进度返回
 */
app.post('/api/upload/ai', upload.single('file'), async (req, res) => {
    // 设置流式响应头
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
        
        // 3. 入库
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

/**
 * API: 获取题目
 * 参数: ?exam_id=123 (必填)
 */
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

/**
 * API: 直接 JSON 导入
 * body: { uploader: string, subject: string, questions: Array | {questions:Array} }
 */
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

/**
 * API: 问 AI 解析
 */
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

/**
 * API: 上传背景图片
 */
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

/**
 * API: 获取可用背景图片列表
 */
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
        
        const backgrounds = imageFiles.map(file => ({
            name: file,
            url: `/uploads/${file}`
        }));
        
        console.log('[背景列表API] 返回的背景列表:', backgrounds);
        res.json({ data: backgrounds });
    } catch (error) {
        console.error('[背景列表API] 获取背景列表失败:', error);
        res.status(500).json({ error: '获取背景列表失败: ' + error.message });
    }
});

// 启动服务器
app.listen(port, () => {
    console.log(`在线答题系统已启动: http://localhost:${port}`);
});
