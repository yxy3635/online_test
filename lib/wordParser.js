const mammoth = require("mammoth");

/**
 * 解析 Word 文档并提取题目 (混合模式)
 * 优先使用 AI 解析，失败则降级到正则表达式
 * 支持：单选题、多选题、判断题、简答题、混合格式
 * @param {Buffer} buffer - 文件 Buffer
 * @returns {Promise<Array>} - 返回题目数组
 */
async function parseWordToQuestions(buffer) {
    try {
        const result = await mammoth.extractRawText({ buffer: buffer });
        const text = result.value;
        
        // 预处理：按行分割
        const lines = text.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        
        const questions = [];
        let currentQuestion = null;
        
        // 状态跟踪
        let lastLineType = 'UNKNOWN'; // QUESTION | OPTION | ANSWER | UNKNOWN
        let lastLineHadJudgementMark = false;

        // ==================== 正则表达式库 ====================
        
        // 1. 题目开始：数字编号 (支持多种格式)
        //    例如：1. 1、 1） 1 1.判断题
        const questionNumberRegex = /^(\d+)[.、\)）\s]/;
        
        // 2. 选项开始 (更宽松，支持更多格式)
        //    例如：A. A、 (A) A） o A • A
        const optionStartRegex = /^(?:[o•·*◦▪▫■□●○◆◇★☆]\s*)?([A-F])[.、\)）:：\s]/i;
        
        // 3. 答案行 (支持多种格式)
        //    字母答案：答案：A  答案：ABC  答：A
        //    判断答案：答案：正确  答：√  答案：错误
        const answerRegex = /^(?:答案|Answer|答|正确答案)[:：\s]*(.+)$/i;
        
        // 4. 判断题标记 (题干末尾)
        //    例如：xxx (√)  xxx（×）
        const judgementMarkRegex = /[\(（]\s*([√×✓✗TFtf对错是否YyNn])\s*[\)）]\s*$/;
        
        // 5. 章节标题 (跳过)
        const chapterRegex = /^(?:第[一二三四五六七八九十\d]+章|[一二三四五六七八九十]、|第\d+节)/;

        // ==================== 辅助函数 ====================
        
        /**
         * 提交当前题目
         */
        const pushCurrentQuestion = () => {
            if (!currentQuestion) return;
            
            // 类型推断
            inferQuestionType(currentQuestion);
            
            // 提取判断题答案（如果题干末尾有标记）
            extractJudgementAnswer(currentQuestion);
            
            // 清理和验证
            currentQuestion.title = currentQuestion.title.trim();
            
            questions.push(currentQuestion);
            currentQuestion = null;
        };

        /**
         * 智能推断题型
         */
        const inferQuestionType = (q) => {
            // 优先级：已有类型 > 根据答案推断 > 根据选项推断
            
            if (q.type && q.type !== '未知') return;
            
            const ans = q.answer || '';
            
            // 判断题特征
            if (ans.match(/^[√×✓✗]$/) || ans.match(/^(正确|错误|对|错|是|否|T|F|True|False)$/i)) {
                q.type = '判断题';
                // 统一答案格式
                if (ans.match(/^(√|✓|正确|对|是|T|True)$/i)) {
                    q.answer = '正确';
                } else if (ans.match(/^(×|✗|错误|错|否|F|False)$/i)) {
                    q.answer = '错误';
                }
                return;
            }
            
            // 多选题特征：答案包含多个字母
            if (ans.match(/^[A-F]{2,}$/i)) {
                q.type = '多选题';
                q.answer = ans.toUpperCase();
                return;
            }
            
            // 单选题特征：答案是单个字母
            if (ans.match(/^[A-F]$/i)) {
                q.type = '单选题';
                q.answer = ans.toUpperCase();
                return;
            }
            
            // 简答题特征：答案很长或没有选项
            if (ans.length > 10 || (q.options.length === 0 && ans.length > 0)) {
                q.type = '简答题';
                return;
            }
            
            // 根据选项数量推断
            if (q.options.length > 0) {
                q.type = '单选题'; // 默认有选项就是单选
            } else {
                q.type = '简答题'; // 默认无选项就是简答
            }
        };

        /**
         * 从题干末尾提取判断题答案
         */
        const extractJudgementAnswer = (q) => {
            if (q.type !== '判断题') return;
            if (q.answer) return; // 已有答案，不提取
            
            const match = q.title.match(judgementMarkRegex);
            if (match) {
                const symbol = match[1];
                // 判断正确还是错误
                if (symbol.match(/[√✓TtYy对是]/)) {
                    q.answer = '正确';
                } else {
                    q.answer = '错误';
                }
                // 从题干中移除答案标记
                q.title = q.title.replace(match[0], '').trim();
            }
        };

        /**
         * 检测是否为选项行
         */
        const isOptionLine = (line) => {
            return optionStartRegex.test(line);
        };

        /**
         * 检测是否为答案行
         */
        const isAnswerLine = (line) => {
            return answerRegex.test(line);
        };

        /**
         * 解析选项行（支持同行多选项）
         */
        const parseOptions = (line) => {
            const options = [];
            
            // 查找所有选项起始位置
            const matches = [...line.matchAll(/(?:^|\s)(?:[o•·*◦▪▫■□●○◆◇★☆]\s*)?([A-F])[.、\)）:：\s]/gi)];
            
            if (matches.length === 0) return options;
            
            if (matches.length === 1) {
                // 单个选项
                const match = line.match(optionStartRegex);
                if (match) {
                    options.push({
                        label: match[1].toUpperCase(),
                        content: line.substring(match[0].length).trim()
                    });
                }
            } else {
                // 多个选项在同一行
                for (let i = 0; i < matches.length; i++) {
                    const start = matches[i].index;
                    const end = (i < matches.length - 1) ? matches[i + 1].index : line.length;
                    const label = matches[i][1].toUpperCase();
                    const fullText = line.substring(start, end).trim();
                    const content = fullText.replace(/^(?:[o•·*◦▪▫■□●○◆◇★☆]\s*)?[A-F][.、\)）:：\s]+/i, '').trim();
                    
                    options.push({ label, content });
                }
            }
            
            return options;
        };

        // ==================== 主循环：逐行解析 ====================
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            
            // 跳过章节标题
            if (chapterRegex.test(line)) {
                continue;
            }
            
            // --- 优先级 1: 识别答案行 ---
            if (isAnswerLine(line)) {
                if (currentQuestion) {
                    const match = line.match(answerRegex);
                    currentQuestion.answer = match[1].trim();
                }
                lastLineType = 'ANSWER';
                lastLineHadJudgementMark = false;
                continue;
            }
            
            // --- 优先级 2: 识别选项行 ---
            if (isOptionLine(line)) {
                if (currentQuestion) {
                    const opts = parseOptions(line);
                    currentQuestion.options.push(...opts);
                }
                lastLineType = 'OPTION';
                lastLineHadJudgementMark = false;
                continue;
            }
            
            // --- 优先级 3: 识别题目开始 ---
            const hasQuestionNumber = questionNumberRegex.test(line);
            const hasJudgementMark = judgementMarkRegex.test(line);
            
            // 决定是否开始新题目
            const shouldStartNew = 
                hasQuestionNumber ||                                    // 有明确的题号
                lastLineType === 'ANSWER' ||                            // 上一行是答案（上一题结束）
                (hasJudgementMark && lastLineHadJudgementMark) ||      // 连续的判断题
                (currentQuestion === null);                             // 第一题
            
            if (shouldStartNew) {
                pushCurrentQuestion(); // 提交旧题
                
                // 创建新题
                let title = line;
                let type = '未知';
                
                // 去除题号
                if (hasQuestionNumber) {
                    title = line.replace(questionNumberRegex, '').trim();
                }
                
                // 检测题型关键词（如果题干中包含"判断题"、"多选题"等）
                if (title.match(/^(判断题|判断|是非题)/i)) {
                    type = '判断题';
                    title = title.replace(/^(判断题|判断|是非题)[：:、\s]*/i, '');
                } else if (title.match(/^(多选题|多选|多项选择题)/i)) {
                    type = '多选题';
                    title = title.replace(/^(多选题|多选|多项选择题)[：:、\s]*/i, '');
                } else if (title.match(/^(单选题|单选|选择题)/i)) {
                    type = '单选题';
                    title = title.replace(/^(单选题|单选|选择题)[：:、\s]*/i, '');
                } else if (title.match(/^(简答题|问答题|填空题)/i)) {
                    type = '简答题';
                    title = title.replace(/^(简答题|问答题|填空题)[：:、\s]*/i, '');
                } else if (hasJudgementMark) {
                    type = '判断题';
                }
                
                currentQuestion = {
                    id: questions.length + 1,
                    title: title,
                    options: [],
                    answer: null,
                    type: type
                };
                
                lastLineType = 'QUESTION';
                lastLineHadJudgementMark = hasJudgementMark;
                
            } else {
                // 延续上一行内容（题干跨行）
                if (currentQuestion) {
                    currentQuestion.title += ' ' + line;
                    
                    // 更新判断题标记状态
                    if (hasJudgementMark) {
                        currentQuestion.type = '判断题';
                        lastLineHadJudgementMark = true;
                    }
                }
            }
        }
        
        // 提交最后一题
        pushCurrentQuestion();
        
        console.log(`[Regex Parser] ✅ 成功解析 ${questions.length} 道题目`);
        return questions;

    } catch (error) {
        console.error("Word 解析失败:", error);
        throw error;
    }
}

module.exports = { parseWordToQuestions };
