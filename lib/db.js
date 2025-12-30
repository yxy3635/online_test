const mysql = require('mysql2/promise');

// 数据库配置
// ⚠️ 请根据你的实际环境修改这里的配置
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'online_test',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// 初始化数据库表
async function initDB() {
    try {
        const connection = await pool.getConnection();
        console.log('数据库连接成功！正在检查表结构...');

        // 1. 创建试卷/科目表 (exams)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS exams (
                id INT AUTO_INCREMENT PRIMARY KEY,
                subject_name VARCHAR(255) NOT NULL,
                uploader_name VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // 2. 创建题目表 (questions)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS questions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                exam_id INT,
                title TEXT NOT NULL,
                options JSON,
                answer TEXT,
                explanation TEXT,  -- 确保这里有 explanation
                type VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX (exam_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        // 3. 自动迁移逻辑：检查并补充缺失字段
        try {
            const [columns] = await connection.query("SHOW COLUMNS FROM questions");
            const columnNames = columns.map(c => c.Field);

            // 检查 exam_id
            if (!columnNames.includes('exam_id')) {
                console.log('正在升级数据库：添加 exam_id 字段...');
                await connection.query("ALTER TABLE questions ADD COLUMN exam_id INT AFTER id");
                await connection.query("CREATE INDEX idx_exam_id ON questions(exam_id)");
            }
            
            // 检查 explanation (就是这里缺失导致报错)
            if (!columnNames.includes('explanation')) {
                console.log('正在升级数据库：添加 explanation 字段...');
                await connection.query("ALTER TABLE questions ADD COLUMN explanation TEXT AFTER answer");
            }

        } catch (e) {
            console.log('检查字段跳过:', e.message);
        }

        console.log('数据库表结构准备就绪。');
        connection.release();
    } catch (error) {
        console.error('数据库初始化失败:', error.message);
        console.error('请检查：1. MySQL 是否启动 2. 用户名密码是否正确');
    }
}

module.exports = { pool, initDB };
