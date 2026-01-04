# 更新
2025.12.30 <br />修复题目出现html元素格式问题。 <br />
2026.01.04 <br />1.自定义背景图片添加懒加载模式，分组加载等。 <br />
           2.新增暗黑主题。<br />
           3.新增错题本。<br />
           4.优化加载速度，清除境外cdn，国内网络使用也能起飞！<br />

# 在线答题系统

一个功能完善的在线答题系统，支持 Word 文档导入、AI 智能解析、在线答题、题目解析等功能。

## 功能特性

### 题目管理
- **多种导入方式**
  - Word 文档上传（.docx 格式）
  - JSON 格式批量导入
  - 支持正则表达式解析和 AI 智能解析两种模式

- **智能题目解析**
  - **正则模式**：快速解析标准格式的 Word 文档
  - **AI 模式**：使用硅基流动 AI 模型深度解析，支持复杂格式和混合题型
  - 自动识别题型：单选题、多选题、判断题、简答题
  - 自动提取题干、选项、答案和解析

- **题目存储**
  - MySQL 数据库存储
  - 支持试卷分类管理
  - 自动记录上传者和创建时间

### 答题功能
- **在线答题**
  - 美观的答题界面
  - 支持单选题、多选题、判断题、简答题
  - 实时显示答题进度
  - 答题卡快速跳转

- **智能解析**
  - AI 自动解析题目
  - 详细的知识点讲解
  - 错误答案分析
  - 个性化学习建议

### 界面定制
- **背景图片**
  - 支持自定义背景图片上传
  - 多种图片格式支持（jpg, jpeg, png, gif, webp）
  - 玻璃模糊效果（毛玻璃）
  - 背景图片管理

- **现代化 UI**
  - 响应式设计，支持移动端
  - 渐变色彩方案
  - 流畅的动画效果
  - 友好的用户体验

### 数据管理
- **试卷列表**
  - 显示所有试卷
  - 显示题目数量
  - 按创建时间排序

- **题目查看**
  - 按试卷查看题目
  - 题目详情展示
  - 支持题目搜索和筛选

## 快速开始

### 环境要求

- Node.js >= 14.0.0
- MySQL >= 5.7
- npm 或 yarn

### 安装步骤

1. **克隆项目**
```bash
git clone https://github.com/yxy3635/online_test
cd onlineTest
```

2. **安装依赖**
```bash
npm install
```

3. **配置数据库**

编辑 `lib/db.js` 文件，修改数据库连接配置：

```javascript
const dbConfig = {
    host: 'localhost',        // 数据库主机地址
    user: 'root',             // 数据库用户名
    password: 'your_password', // 数据库密码  
    database: 'online_test',  // 数据库名称
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};
```

4. **创建数据库**

在 MySQL 中创建数据库（如果不存在）：
```sql
CREATE DATABASE IF NOT EXISTS online_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

5. **配置硅基流动 API**

编辑 `lib/aiParser.js` 文件，修改 AI 配置：

```javascript
const AI_CONFIG = {
    provider: 'siliconflow', 
    siliconflow: {
        apiKey: 'sk-your-api-key-here',  // 请替换为您的实际 API Key
        
        apiUrl: 'api.siliconflow.cn',
        apiPath: '/v1/chat/completions',
        
        // 使用的模型（可根据需要修改）
        model: 'Qwen/Qwen2.5-Coder-7B-Instruct' 
    }
};
```

**获取硅基流动 API Key：**
1. 访问 [硅基流动官网](https://siliconflow.cn/)
2. 注册/登录账号
3. 在控制台获取 API Key
4. 将 API Key 填入配置文件中

6. **启动服务**

```bash
npm start
```

### 可选配置项

#### 服务器端口 (`server.js`)

默认端口为 3000，如需修改：

```javascript
const port = 3000;  
```

#### 文件上传限制 (`server.js`)

```javascript
limits: { fileSize: 64 * 1024 * 1024 }  // 64MB，可根据需要调整
```

## 使用指南

### 导入题目

#### 方式一：Word 文档上传

1. 点击"上传题目"按钮
2. 选择 Word 文档（.docx 格式）
3. 填写科目名称和上传者姓名
4. 选择解析模式：
   - **正则模式**：快速解析，适合标准格式
   - **AI 模式**：智能解析，适合复杂格式（需要配置 API Key）
5. 等待解析完成

#### 方式二：JSON 格式导入

1. 准备 JSON 格式的题目数据：

```json
{
  "uploader": "张三",
  "subject": "计算机基础",
  "questions": [
    {
      "title": "HTML是什么？",
      "type": "单选题",
      "options": [
        {"label": "A", "content": "超文本标记语言"},
        {"label": "B", "content": "编程语言"}
      ],
      "answer": "A",
      "explanation": "HTML是超文本标记语言"
    }
  ]
}
```

2. 通过 API 接口导入：
```bash
POST /api/upload/json
Content-Type: application/json

{
  "uploader": "张三",
  "subject": "计算机基础",
  "questions": [...]
}
```

### 答题流程

1. 在首页选择试卷
2. 进入答题界面
3. 选择答案（支持单选、多选、判断、简答）
4. 点击"提交答案"查看结果
5. 点击"AI 解析"获取详细解析

### 背景图片设置

1. 点击右上角设置按钮
2. 选择"背景设置"
3. 上传背景图片或选择已有图片
4. 图片会自动应用为页面背景

## API 接口

### 试卷相关

- `GET /api/exams` - 获取所有试卷列表
- `GET /api/questions?exam_id=123` - 获取指定试卷的题目

### 上传相关

- `POST /api/upload` - 上传 Word 文档（正则解析）
- `POST /api/upload/ai` - 上传 Word 文档（AI 解析，流式返回）
- `POST /api/upload/json` - JSON 格式导入题目

### 其他

- `POST /api/ask-ai` - 请求 AI 解析单道题目

## 项目结构

```
onlineTest/
├── lib/                    # 核心库文件
│   ├── db.js              # 数据库配置和初始化
│   ├── aiParser.js        # AI 解析器（硅基流动）
│   └── wordParser.js      # Word 文档解析器（正则）
├── public/                 # 前端静态文件
│   └── index.html         # 主页面
├── uploads/                # 上传文件目录
│   └── ...                # 背景图片等
├── server.js               # Express 服务器
├── package.json           # 项目配置
└── README.md              
```

## 🛠️ 技术栈

- **后端**
  - Node.js + Express
  - MySQL2（数据库）
  - Multer（文件上传）
  - Mammoth（Word 文档解析）

- **前端**
  - 原生 HTML/CSS/JavaScript
  - 响应式设计

- **AI 服务**
  - 硅基流动（SiliconFlow）

## 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

GPL-2.0 license






