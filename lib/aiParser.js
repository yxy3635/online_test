const https = require('https');

/**
 * 使用 AI 模型解析题库文本
 * 配置：硅基流动 (SiliconFlow) - Qwen2.5-Coder-7B-Instruct (免费版)
 */

// ===== 配置区域 =====
const AI_CONFIG = {
    provider: 'siliconflow', 
    
    // 硅基流动配置
    siliconflow: {
        // ⚠️ 请在此处填入您的 API Key (格式 sk-xxxx)
        apiKey:'sk-jzqdfftinpxqyakmclwfxokxkbchrpobdqzbcluusburdzvu',
        
        apiUrl: 'api.siliconflow.cn',
        apiPath: '/v1/chat/completions',
        
        // 指定免费且强大的编程模型
        model: 'Qwen/Qwen2.5-Coder-7B-Instruct' 
    }
};

// 系统提示词
const SYSTEM_PROMPT = `你是一个专业的试题解析助手。请读取用户的题库文本，并将其转换为标准的 JSON 格式。

【输出要求】
1. 只返回一个 JSON 数组，不要包含 markdown 代码块（如 \`\`\`json），不要包含任何解释性文字。
2. 数组中每个对象必须包含以下字段：
   - "title": (字符串) 题干内容
   - "type": (字符串) 题型，只能是："单选题"、"多选题"、"判断题"、"简答题" 之一
   - "options": (数组) 选项列表。每个选项包含 "label" (如 "A") 和 "content" (内容)。判断题/简答题此字段为空数组 []。
   - "answer": (字符串) 正确答案。单选如 "A"，多选如 "ABC"，判断题统一为 "正确" 或 "错误"。
   - "explanation": (字符串) 解析。如果没有则留空字符串。

【处理规则】
- 自动去除题干开头的数字编号（如 "1."）。
- 判断题若题干末尾有 (√) 或 (×)，请去除并填入 answer 字段。
- 确保 JSON 格式合法。所有字符串值必须使用双引号 (")，不要使用中文引号 (“”)。如果题干本身包含引号，请正确转义。

【示例】
[
  {"title": "HTML是什么？", "type": "单选题", "options": [{"label":"A","content":"超文本标记语言"},{"label":"B","content":"编程语言"}], "answer": "A", "explanation": "基础概念"},
  {"title": "地球是平的", "type": "判断题", "options": [], "answer": "错误", "explanation": ""}
]`;

/**
 * 核心：AI 润色/校对题目
 * 接收粗糙的题目文本，返回标准的 JSON
 */
async function refineQuestionsWithAI(rawText, config) {
    const isR1Model = config.model.includes('R1') || config.model.includes('r1');
    
    const requestData = JSON.stringify({
        model: config.model,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: rawText }
        ],
        temperature: isR1Model ? 0.2 : 0.1,
        max_tokens: 4000,
        stream: false
    });
    
    // 设置请求选项
    const options = {
        hostname: config.apiUrl,
        port: 443,
        path: config.apiPath,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Length': Buffer.byteLength(requestData)
        }
    };
    
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            
            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) {
                        return reject(new Error(`API请求失败 (${res.statusCode}): ${data}`));
                    }

                    const response = JSON.parse(data);
                    if (response.error) {
                        return reject(new Error(`API Error: ${response.error.message}`));
                    }
                    
                    let content = response.choices?.[0]?.message?.content;
                    if (!content) {
                        return reject(new Error('API 返回内容为空'));
                    }
                    
                    content = content.replace(/```json/g, '').replace(/```/g, '').trim();

                    let questions;
                    try {
                        questions = JSON.parse(content);
                    } catch (e) {
                        console.warn("[AI] JSON解析失败，尝试自动修复...", e.message);
                        let fixedContent = content.replace(/[“”]/g, '"');
                        fixedContent = fixedContent.replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');
                        try {
                            questions = JSON.parse(fixedContent);
                        } catch (e2) {
                            if (fixedContent.trim().startsWith('[') && !fixedContent.trim().endsWith(']')) {
                                fixedContent += ']';
                                try {
                                    questions = JSON.parse(fixedContent);
                                } catch (e3) {
                                    const lastBrace = fixedContent.lastIndexOf('}');
                                    if (lastBrace > 0) {
                                        const truncated = fixedContent.substring(0, lastBrace + 1) + ']';
                                        try {
                                            questions = JSON.parse(truncated);
                                        } catch (e4) {
                                            throw e;
                                        }
                                    } else {
                                        throw e;
                                    }
                                }
                            } else {
                                throw e;
                            }
                        }
                    }
                    
                    if (!Array.isArray(questions)) {
                        return reject(new Error('AI 返回数据不是数组'));
                    }
                    
                    resolve(questions);
                } catch (error) {
                    console.error("解析响应失败:", error);
                    reject(error);
                }
            });
        });
        
        req.on('error', (err) => reject(new Error(`网络请求失败: ${err.message}`)));

        req.setTimeout(600000, () => {
            req.destroy();
            reject(new Error('请求超时（已等待 10 分钟）'));
        });
        
        req.write(requestData);
        req.end();
    });
}

/**
 * 新版入口：直接基于文本分块的 AI 解析 (避免正则预处理切断长题目)
 * @param {string} fullText - 文档全文
 * @param {function} onProgress - 进度回调 (progress, message)
 */
async function parseWithAI(fullText, onProgress) {
    const config = AI_CONFIG.siliconflow;
    if (!config.apiKey || config.apiKey === 'YOUR_API_KEY_HERE') {
        throw new Error('请配置 API Key');
    }

    if (typeof fullText !== 'string') {
        throw new Error('parseWithAI 期望接收字符串文本，但收到了 ' + typeof fullText);
    }

    const chunks = splitTextIntoChunks(fullText, 1500);
    const totalChunks = chunks.length;
    
    const allFinalQuestions = [];

    for (let i = 0; i < totalChunks; i++) {
        const chunkText = chunks[i];

        if (onProgress) {
            const percent = Math.round((i / totalChunks) * 100);
            onProgress(percent, `正在 AI 深度解析第 ${i + 1}/${totalChunks} 部分...`);
        }

        try {
            let refinedBatch;
            try {
                refinedBatch = await refineQuestionsWithAI(chunkText, config);
            } catch (firstErr) {
                console.warn(`[AI] 第 ${i + 1} 块首次请求失败 (${firstErr.message})，正在重试...`);
                await new Promise(r => setTimeout(r, 2000));
                refinedBatch = await refineQuestionsWithAI(chunkText, config);
            }
            
            if (refinedBatch) {
                refinedBatch.forEach(q => {
                    if (q.type === '判断题' && q.title) {
                        const judgeRegex = /[\(（]\s*[√×✓✗TFtf对错是否YyNn]\s*[\)）]\s*$/;
                        q.title = q.title.replace(judgeRegex, '').trim();
                    }
                });
                allFinalQuestions.push(...refinedBatch);
            }
            
        } catch (err) {
            console.error(`[AI] 第 ${i + 1} 块处理失败:`, err.message);
            allFinalQuestions.push({
                title: "【解析失败片段】" + chunkText.substring(0, 50) + "...",
                type: "简答题",
                options: [],
                answer: "AI 解析失败，请手动检查原始内容：\n" + chunkText,
                explanation: "系统错误"
            });
        }

        if (i < totalChunks - 1) {
            await new Promise(r => setTimeout(r, 800));
        }
    }

    if (onProgress) onProgress(100, '所有题目解析完成，正在入库...');
    return allFinalQuestions;
}

/**
 * 辅助函数：智能文本切分
 * @param {string} text - 全文
 * @param {number} targetSize - 目标每块大小
 * @returns {Array<string>} - 文本块数组
 */
function splitTextIntoChunks(text, targetSize) {
    const chunks = [];
    const lines = text.split('\n');
    let currentChunk = '';

    const newQuestionRegex = /^(\d+)[.、\)）]/;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const prospectiveChunk = currentChunk + (currentChunk ? '\n' : '') + line;
        
        if (prospectiveChunk.length < targetSize) {
            currentChunk = prospectiveChunk;
            continue;
        }

        const isNewQuestion = newQuestionRegex.test(line.trim());

        if (isNewQuestion || prospectiveChunk.length > targetSize * 1.5) {
            if (currentChunk.trim().length > 0) {
                chunks.push(currentChunk);
            }
            currentChunk = line;
        } else {
            currentChunk = prospectiveChunk;
        }
    }
    
    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk);
    }
    
    return chunks;
}

/**
 * 获取配置状态
 */
function getConfigInfo() {
    const config = AI_CONFIG.siliconflow;
    const hasKey = config.apiKey && config.apiKey !== 'YOUR_API_KEY_HERE';
    return {
        provider: 'siliconflow',
        model: config.model,
        configured: hasKey
    };
}

/**
 * 针对单道题请求 AI 解析
 * @param {Object} questionData - { title, options, answer, userAnswer }
 */
async function askAIForExplanation(questionData) {
    const config = AI_CONFIG.siliconflow;
    if (!config.apiKey) throw new Error('API Key未配置');

    let content = `请作为一名老师，为学生解析这道题。\n\n`;
    content += `题目：${questionData.title}\n`;
    if (questionData.options && Array.isArray(questionData.options) && questionData.options.length) {
        content += `选项：\n${questionData.options.map(o => o.label + '. ' + o.content).join('\n')}\n`;
    }
    content += `\n标准答案：${questionData.answer}\n`;
    content += `用户回答：${questionData.userAnswer || '未作答'}\n`;
    content += `\n请给出详细的解析，解释知识点，并指出用户回答的对错之处（如果答错的话）。`;

    const requestData = JSON.stringify({
        model: config.model,
        messages: [
            { role: 'system', content: '你是一位耐心、专业的辅导老师。请用通俗易懂的语言解析题目。' },
            { role: 'user', content: content }
        ],
        temperature: 0.3, 
        max_tokens: 1000,
        stream: false
    });

    const options = {
        hostname: config.apiUrl,
        port: 443,
        path: config.apiPath,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Length': Buffer.byteLength(requestData)
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            
            res.on('end', () => {
                if (res.statusCode !== 200) return reject(new Error(`API请求失败: ${res.statusCode}`));
                try {
                    const response = JSON.parse(data);
                    const reply = response.choices?.[0]?.message?.content;
                    resolve(reply || 'AI 未返回内容');
                } catch (e) {
                    reject(e);
                }
            });
        });
        
        req.on('error', err => reject(err));
        const isR1Model = config.model.includes('R1') || config.model.includes('r1');
        req.setTimeout(isR1Model ? 300000 : 60000, () => {
            req.destroy();
            reject(new Error('AI 响应超时'));
        });
        
        req.write(requestData);
        req.end();
    });
}

module.exports = {
    parseWithAI,
    askAIForExplanation,
    getConfigInfo
};
