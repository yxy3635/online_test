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
        
        const lines = text.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        
        const questions = [];
        let currentQuestion = null;
        let lastLineType = 'UNKNOWN';
        let lastLineHadJudgementMark = false;

        const questionNumberRegex = /^(\d+)[.、\)）\s]/;
        const optionStartRegex = /^(?:[o•·*◦▪▫■□●○◆◇★☆]\s*)?([A-F])[.、\)）:：\s]/i;
        const answerRegex = /^(?:答案|Answer|答|正确答案)[:：\s]*(.+)$/i;
        const judgementMarkRegex = /[\(（]\s*([√×✓✗TFtf对错是否YyNn])\s*[\)）]\s*$/;
        const chapterRegex = /^(?:第[一二三四五六七八九十\d]+章|[一二三四五六七八九十]、|第\d+节)/;

        const pushCurrentQuestion = () => {
            if (!currentQuestion) return;
            inferQuestionType(currentQuestion);
            extractJudgementAnswer(currentQuestion);
            currentQuestion.title = currentQuestion.title.trim();
            questions.push(currentQuestion);
            currentQuestion = null;
        };

        const inferQuestionType = (q) => {
            if (q.type && q.type !== '未知') return;
            const ans = q.answer || '';

            if (ans.match(/^[√×✓✗]$/) || ans.match(/^(正确|错误|对|错|是|否|T|F|True|False)$/i)) {
                q.type = '判断题';
                if (ans.match(/^(√|✓|正确|对|是|T|True)$/i)) {
                    q.answer = '正确';
                } else if (ans.match(/^(×|✗|错误|错|否|F|False)$/i)) {
                    q.answer = '错误';
                }
                return;
            }

            if (ans.match(/^[A-F]{2,}$/i)) {
                q.type = '多选题';
                q.answer = ans.toUpperCase();
                return;
            }

            if (ans.match(/^[A-F]$/i)) {
                q.type = '单选题';
                q.answer = ans.toUpperCase();
                return;
            }

            if (ans.length > 10 || (q.options.length === 0 && ans.length > 0)) {
                q.type = '简答题';
                return;
            }

            if (q.options.length > 0) {
                q.type = '单选题';
            } else {
                q.type = '简答题';
            }
        };

        const extractJudgementAnswer = (q) => {
            if (q.type !== '判断题') return;
            if (q.answer) return;

            const match = q.title.match(judgementMarkRegex);
            if (match) {
                const symbol = match[1];
                if (symbol.match(/[√✓TtYy对是]/)) {
                    q.answer = '正确';
                } else {
                    q.answer = '错误';
                }
                q.title = q.title.replace(match[0], '').trim();
            }
        };

        const isOptionLine = (line) => {
            return optionStartRegex.test(line);
        };

        const isAnswerLine = (line) => {
            return answerRegex.test(line);
        };

        const parseOptions = (line) => {
            const options = [];
            const matches = [...line.matchAll(/(?:^|\s)(?:[o•·*◦▪▫■□●○◆◇★☆]\s*)?([A-F])[.、\)）:：\s]/gi)];

            if (matches.length === 0) return options;

            if (matches.length === 1) {
                const match = line.match(optionStartRegex);
                if (match) {
                    options.push({
                        label: match[1].toUpperCase(),
                        content: line.substring(match[0].length).trim()
                    });
                }
            } else {
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

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            if (chapterRegex.test(line)) {
                continue;
            }

            if (isAnswerLine(line)) {
                if (currentQuestion) {
                    const match = line.match(answerRegex);
                    currentQuestion.answer = match[1].trim();
                }
                lastLineType = 'ANSWER';
                lastLineHadJudgementMark = false;
                continue;
            }

            if (isOptionLine(line)) {
                if (currentQuestion) {
                    const opts = parseOptions(line);
                    currentQuestion.options.push(...opts);
                }
                lastLineType = 'OPTION';
                lastLineHadJudgementMark = false;
                continue;
            }
            
            const hasQuestionNumber = questionNumberRegex.test(line);
            const hasJudgementMark = judgementMarkRegex.test(line);

            const shouldStartNew =
                hasQuestionNumber ||
                lastLineType === 'ANSWER' ||
                (hasJudgementMark && lastLineHadJudgementMark) ||
                (currentQuestion === null);

            if (shouldStartNew) {
                pushCurrentQuestion();

                let title = line;
                let type = '未知';

                if (hasQuestionNumber) {
                    title = line.replace(questionNumberRegex, '').trim();
                }

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
                if (currentQuestion) {
                    currentQuestion.title += ' ' + line;
                    if (hasJudgementMark) {
                        currentQuestion.type = '判断题';
                        lastLineHadJudgementMark = true;
                    }
                }
            }
        }
        
        pushCurrentQuestion();
        console.log(`[Regex Parser] ✅ 成功解析 ${questions.length} 道题目`);
        return questions;

    } catch (error) {
        console.error("Word 解析失败:", error);
        throw error;
    }
}

module.exports = { parseWordToQuestions };
