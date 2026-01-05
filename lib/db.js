const mysql = require('mysql2/promise');

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

async function initDB() {
    try {
        const connection = await pool.getConnection();
        console.log('数据库连接成功！正在检查表结构...');

        await connection.query(`
            CREATE TABLE IF NOT EXISTS exams (
                id INT AUTO_INCREMENT PRIMARY KEY,
                subject_name VARCHAR(255) NOT NULL,
                uploader_name VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS questions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                exam_id INT,
                title TEXT NOT NULL,
                options JSON,
                answer TEXT,
                explanation TEXT,
                type VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX (exam_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS system_stats (
                id INT PRIMARY KEY,
                total_usage_seconds BIGINT DEFAULT 0,
                total_visits INT DEFAULT 0
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        const [stats] = await connection.query('SELECT * FROM system_stats WHERE id = 1');
        if (stats.length === 0) {
            await connection.query('INSERT INTO system_stats (id, total_usage_seconds, total_visits) VALUES (1, 0, 0)');
        }

        try {
            const [columns] = await connection.query("SHOW COLUMNS FROM questions");
            const columnNames = columns.map(c => c.Field);

            if (!columnNames.includes('exam_id')) {
                console.log('正在升级数据库：添加 exam_id 字段...');
                await connection.query("ALTER TABLE questions ADD COLUMN exam_id INT AFTER id");
                await connection.query("CREATE INDEX idx_exam_id ON questions(exam_id)");
            }

            if (!columnNames.includes('explanation')) {
                console.log('正在升级数据库：添加 explanation 字段...');
                await connection.query("ALTER TABLE questions ADD COLUMN explanation TEXT AFTER answer");
            }

        } catch (e) {
            console.log('检查字段跳过:', e.message);
        }

        try {
            const [examColumns] = await connection.query("SHOW COLUMNS FROM exams");
            const examColumnNames = examColumns.map(c => c.Field);

            if (!examColumnNames.includes('rate')) {
                console.log('正在升级数据库：添加 exams.rate 字段...');
                await connection.query("ALTER TABLE exams ADD COLUMN rate DECIMAL(3,1) DEFAULT 5.0 AFTER uploader_name");
                console.log('✓ exams.rate 字段添加成功');
            }

            if (!examColumnNames.includes('ratenums')) {
                console.log('正在升级数据库：添加 exams.ratenums 字段...');
                await connection.query("ALTER TABLE exams ADD COLUMN ratenums INT DEFAULT 0 AFTER rate");
                console.log('✓ exams.ratenums 字段添加成功');
            }
        } catch (e) {
            console.error('检查 exams 表字段时出错:', e.message);
            console.error('错误详情:', e);
        }

        console.log('数据库表结构准备就绪。');
        connection.release();
    } catch (error) {
        console.error('数据库初始化失败:', error.message);
        console.error('请检查：1. MySQL 是否启动 2. 用户名密码是否正确');
    }
}

module.exports = { pool, initDB };
