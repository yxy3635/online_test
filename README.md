## 更新历史

2025.12.30 <br />修复题目出现html元素格式问题。 <br />
2026.01.04 <br />1. 自定义背景图片添加懒加载模式，分组加载等。 <br />
           2. 新增暗黑主题。<br />
           3. 新增错题本。<br />
           4. 优化加载速度，清除境外CDN，国内网络使用也能起飞！<br />
2026.01.05 <br />新增评分插件。 <br />

2026.01.10 <br />

1. 新增返回上一题快捷键和按钮。<br />
2. 修复错题本题目重复添加bug。<br />
3. 错题本新增可选错误自动添加到错题本。<br />
4. 导入题库新增预览确认流程。<br />
5. 新增局域网共享快捷启动方式，指令 `node server-lan.js`，需要放行 Windows 安全组。<br />
6. 新增辅助修改开放 Windows 安全组脚本 `setup-firewall.bat`。<br />

2026.06.02 <br />

1. 答题页问AI功能升级，支持 Markdown 格式渲染（标题、列表、代码块、表格等）。<br />

2026.06.04 <br />

1. UI 主题全新升级为护眼墨绿色，适配暗黑模式。<br />
2. 新增后台管理系统（`/admin.html`），支持题库编辑、题目管理、管理员账号管理。<br />
3. 题库与解析支持代码块（``` ```）渲染，集成 highlight.js 语法高亮。<br />
4. JSON 上传区新增代码框格式提示与示例。<br />

---

# 千纸雏鸢 · 在线答题系统

一个功能完善的在线答题系统，支持 Word 文档导入、AI 智能解析、在线答题、题目解析、挑战模式、后台管理等功能。

GitHub: [https://github.com/yxy3635/online_test](https://github.com/yxy3635/online_test)

## 功能特性

### 答题功能

- **多题型支持**：单选题、多选题、判断题、简答题、填空题
- **实时进度**：答题卡导航，已答/未答一目了然
- **即时反馈**：提交后立刻显示对错、正确答案和解析
- **AI 智能解析**：点击「问AI」按钮，为你详细讲解每道题，支持 Markdown 富文本渲染
- **代码块渲染**：题目和解析中支持 `` ``` `` 代码块，自动语法高亮（highlight.js）
- **题库评分**：1-5 星评分系统，帮助筛选优质题库

### 题目管理

- **三种导入方式**：
  - **Word 文档**（.docx）：拖拽上传，支持正则或 AI 两种解析模式
  - **JSON 批量导入**：提供格式模板，一键复制粘贴，支持代码块格式
  - **AI 极速解析**：DeepSeek V4 大模型精准识别复杂排版，流式显示进度
- **题目存储**：MySQL 数据库，支持试卷分类、上传者溯源

### 后台管理

- **管理员登录**：独立后台页面 `/admin.html`，初始账号 `admin` / `admin123`
- **首次强制改密**：首次登录必须修改默认密码
- **题库管理**：查看、编辑、删除题库，修改题库信息
- **题目管理**：逐题编辑题干、选项、答案、解析、题型
- **账号管理**：新增/删除管理员、重置密码
- **会话安全**：Token 认证，2 小时无操作自动过期

### 学习工具

- **错题本**：手动/自动收录错题，支持批量重做、反选删除
- **挑战模式**：多题库混合随机抽题，支持题型筛选，历史记录留存本地
- **仪表盘**：实时展示系统运行状态、题库总量、在线人数、贡献排行

### 界面定制

- **护眼墨绿主题**：全局豆沙绿色系，柔和护眼
- **暗黑模式**：一键切换墨绿暗色主题，深夜刷题不伤眼
- **自定义背景**：上传本地图片作为背景，毛玻璃效果
- **响应式设计**：完美适配手机、平板、电脑
- **键盘快捷键**：← → 翻题，Enter 提交，自定义键位

### 局域网共享

- **LAN 模式**：一键启动局域网服务器，同 WiFi 下手机平板都能访问
- **一键配置防火墙**：`setup-firewall.bat` 自动放行端口

---

## 快速开始

### 环境要求

| 组件      | 版本要求     |
| ------- | -------- |
| Node.js | ≥ 14.0.0 |
| MySQL   | ≥ 5.7    |
| npm     | 任意版本     |

### 1. 克隆项目

```bash
git clone https://github.com/yxy3635/online_test
cd onlineTest
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置数据库

在 MySQL 中创建数据库：

```sql
CREATE DATABASE IF NOT EXISTS online_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

编辑 `lib/db.js`，修改数据库连接信息：

```js
const dbConfig = {
    host: 'localhost',        // 数据库地址
    user: 'root',             // 数据库用户名
    password: 'your_password', // 数据库密码
    database: 'online_test',  // 数据库名称
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};
```

服务启动后会自动建表（包括管理员表），无需手动执行 SQL。

### 4. 配置 DeepSeek API Key（必做）

> **AI 解析和「问AI」功能依赖 DeepSeek API，必须配置！**

1. 访问 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 注册并获取 API Key
2. 编辑 `lib/aiParser.js`，将 API Key 填入：

```js
deepseek: {
    apiKey: 'sk-你的APIKey',  // 替换这里
    apiUrl: 'api.deepseek.com',
    apiPath: '/v1/chat/completions',
    model: 'deepseek-v4-pro'  // 旗舰模型，也可换 deepseek-v4-flash
}
```

| 模型                  | 说明             |
| ------------------- | -------------- |
| `deepseek-v4-pro`   | 旗舰版，最强推理能力（推荐） |
| `deepseek-v4-flash` | 轻量版，速度更快、成本更低  |

### 5. 启动服务

```bash
npm start
```

浏览器访问 [http://localhost:3000](http://localhost:3000) 即可使用。

---

## 使用教程

### 一、导入题库

#### 方式 A：Word 文档上传（推荐）

1. 点击首页的 **「上传新题目」** 按钮
2. 填写**科目名称**（如"2024 期末复习题"）和**上传者姓名**
3. 点击上传区域选择 `.docx` 文件
4. 选择解析模式：
   - **普通上传**：正则解析，速度快，适合格式规范的文档
   - **AI 极速解析**：DeepSeek 大模型识别，适合排版复杂的文档，实时显示进度
   - **JSON 导入**：直接粘贴 JSON 数据，最稳定
5. 点击 **「确认上传」**，等待解析完成

#### 方式 B：JSON 导入

在"解析模式"中选择 **「JSON 导入」**，按模板格式粘贴数据：

```json
[
  {
    "type": "单选题",
    "title": "HTML 的全称是什么？",
    "options": [
      { "label": "A", "content": "Hyper Text Markup Language" },
      { "label": "B", "content": "High Tech Modern Language" }
    ],
    "answer": "A",
    "explanation": "HTML 是超文本标记语言的缩写。"
  }
]
```

> 页面右侧有完整模板，支持一键复制。题目中可使用 `` ``` `` 包裹代码块，答题时自动语法高亮。

#### Word 文档格式建议

为了让解析更准确，建议按以下格式编写 Word 文档：

```
一、单选题
1. HTML的全称是什么？
A. Hyper Text Markup Language
B. High Tech Modern Language
答案：A

2. CSS的全称是什么？
A. Cascading Style Sheets
B. Computer Style System
答案：A
```

> AI 模式对格式要求更宽松，排版不规范也能较好识别。

---

### 二、在线答题

1. 在首页**点击题库卡片**进入答题页面
2. 选择答案后点击 **「提交本题」**（或按 `Enter` 键）
3. 系统即时显示对错、正确答案和解析
4. 使用底部按钮或按 `←` `→` 方向键翻题
5. 右侧答题卡可快速跳转到任意题目

#### 题目状态说明

| 图标   | 含义   |
| ---- | ---- |
| 白色方块 | 未作答  |
| 绿色方块 | 已答对  |
| 红色方块 | 已答错  |
| 紫色边框 | 当前题目 |

---

### 三、AI 智能解析

答题后，在结果反馈区域点击 **「问AI」** 按钮：

- DeepSeek V4 会分析题目知识点
- 解释每个选项的对错原因
- 指出你的回答为什么对/错
- 返回格式丰富的 Markdown 内容（标题、列表、代码块、粗体等）
- 代码块自动语法高亮
- 点击「重新提问」可再次请求解析

---

### 四、挑战模式

1. 点击首页 **「挑战模式」** 按钮
2. 勾选要参与的题库（可多选）
3. 选择题型范围（单选/多选/判断/简答/填空）
4. 设置抽取题目数量
5. 点击 **「立即开始挑战」**
6. 挑战结果自动保存在本地浏览器的历史记录中

> 点击右上角「历史记录」可查看所有挑战成绩。

---

### 五、错题本

- **手动添加**：答题后点击「加入错题」按钮
- **自动添加**：在错题本页面打开「自动添加错题本」开关，答错自动收录
- **批量操作**：全选 → 一键删除或全部重做
- 错题数据存储在浏览器 localStorage 中

---

### 六、后台管理

访问 `/admin.html` 进入管理后台。

- **初始账号**：`admin` / `admin123`
- **首次登录**：强制修改密码后方可使用
- **控制面板**：查看题库总数、题目总数、管理员数、平均评分
- **题库管理**：查看/编辑/删除题库，逐题编辑题干、选项、答案、解析
- **账号管理**：新增/删除管理员、重置密码

---

### 七、背景设置

1. 点击右上角 **「背景设置」** 按钮
2. 选择已有背景图片，或上传自己的图片
3. 支持 jpg / png / gif / webp 格式
4. 设置后页面自动应用毛玻璃效果

---

### 八、局域网共享

让同一 WiFi 下的手机、平板等其他设备也能访问：

```bash
# 方式一：快捷启动
npm run start:lan

# 方式二：直接运行
node server-lan.js
```

> **首次使用需要放行防火墙**：
> 
> - 右键以**管理员身份**运行 `setup-firewall.bat`
> - 或手动执行：`netsh advfirewall firewall add rule name="Node.js Server Port 3000" dir=in action=allow protocol=TCP localport=3000`

启动后终端会显示本机局域网 IP，其他设备在同 WiFi 下访问 `http://你的IP:3000` 即可。

---

## API 接口

### 前台接口

| 方法     | 路径                          | 说明                    |
| ------ | --------------------------- | --------------------- |
| `GET`  | `/api/exams`                | 获取所有试卷列表              |
| `GET`  | `/api/questions?exam_id=ID` | 获取指定试卷的题目             |
| `POST` | `/api/upload`               | Word 文档上传（正则解析）       |
| `POST` | `/api/upload/ai`            | Word 文档上传（AI 解析，流式进度） |
| `POST` | `/api/upload/json`          | JSON 格式导入题目           |
| `POST` | `/api/ask-ai`               | AI 解析单道题              |
| `POST` | `/api/upload/background`    | 上传背景图片                |
| `GET`  | `/api/backgrounds`          | 获取背景图片列表（分页）          |
| `POST` | `/api/exam/rate`            | 题库评分                  |
| `POST` | `/api/heartbeat`            | 在线心跳                  |
| `GET`  | `/api/stats`                | 仪表盘统计数据               |

### 管理员接口（需登录）

| 方法       | 路径                                    | 说明              |
| -------- | ------------------------------------- | --------------- |
| `POST`   | `/api/admin/login`                    | 管理员登录           |
| `POST`   | `/api/admin/logout`                   | 退出登录            |
| `GET`    | `/api/admin/me`                       | 验证会话，获取当前用户信息   |
| `POST`   | `/api/admin/change-password`          | 修改自己的密码         |
| `GET`    | `/api/admin/exams`                    | 题库列表（含题目数）      |
| `GET`    | `/api/admin/exams/:id`                | 单个题库详情          |
| `PUT`    | `/api/admin/exams/:id`                | 更新题库信息          |
| `DELETE` | `/api/admin/exams/:id`                | 删除题库及所有题目       |
| `GET`    | `/api/admin/exams/:id/questions`      | 题库下的题目列表        |
| `GET`    | `/api/admin/questions/:id`            | 单个题目详情          |
| `PUT`    | `/api/admin/questions/:id`            | 更新题目            |
| `DELETE` | `/api/admin/questions/:id`            | 删除题目            |
| `GET`    | `/api/admin/accounts`                 | 管理员账号列表         |
| `POST`   | `/api/admin/accounts`                 | 新增管理员           |
| `DELETE` | `/api/admin/accounts/:id`             | 删除管理员（不可删除自己）   |
| `POST`   | `/api/admin/accounts/:id/reset-password` | 重置其他管理员的密码      |

---

## 项目结构

```
onlineTest/
├── lib/
│   ├── db.js              # 数据库连接与自动迁移
│   ├── aiParser.js        # AI 解析器（DeepSeek API）
│   ├── wordParser.js      # Word 文档正则解析器
│   ├── adminAuth.js       # 管理员认证中间件
│   └── adminRoutes.js     # 管理员 API 路由
├── public/
│   ├── index.html         # 前端主页面（单页应用）
│   ├── admin.html         # 后台管理页面
│   └── js/
│       └── chart.js       # Chart.js 图表库
├── uploads/               # 上传文件目录（背景图片等）
├── server.js              # Express 服务器入口（localhost）
├── server-lan.js          # 局域网共享模式入口（0.0.0.0）
├── setup-firewall.bat     # Windows 防火墙一键配置脚本
└── package.json
```

## 技术栈

| 层级      | 技术                                                         |
| ------- | ---------------------------------------------------------- |
| 后端      | Node.js + Express                                          |
| 数据库     | MySQL2                                                     |
| 文件解析    | Mammoth（Word）、Multer（上传）                                   |
| AI 引擎   | DeepSeek V4（deepseek-v4-pro）                               |
| 前端      | 原生 HTML / CSS / JavaScript（无框架）                            |
| 图表      | Chart.js                                                   |
| 语法高亮    | highlight.js                                               |
| 认证      | SHA-256 + 会话令牌                                             |

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

GPL-2.0 license
