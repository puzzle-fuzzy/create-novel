// LLM 深度审查 — 评估章节质量，给出具体改进建议

import type { ChapterOutline } from '../config';

export interface ReviewResult {
  overallScore: number; // 1-10
  scores: {
    plotCompletion: number;
    characterConsistency: number;
    contextCoherence: number;
    writingQuality: number;
    attractiveness: number;
  };
  issues: string[];
  highlights: string[];
  rewriteAdvice: string;
}

export function buildReviewPrompt(
  content: string,
  outline: ChapterOutline,
  stateSummary: string,
): string {
  // 截断过长内容，审查不需要完整章节
  const MAX_REVIEW_CONTENT = 6000;
  const reviewContent = content.length > MAX_REVIEW_CONTENT
    ? content.slice(0, MAX_REVIEW_CONTENT) + '\n\n……（章节后半部分省略）'
    : content;

  return `你是一位极其严格的小说编辑，你审查的标准是出版级质量。请审查以下章节。

## 本章大纲要求
标题：${outline.title}
概要：${outline.summary}
关键场景：${outline.keyScenes.join('；')}
情绪基调：${outline.mood}
${outline.cliffhanger ? `章末悬念要求：${outline.cliffhanger}` : ''}

## 当前故事状态
${stateSummary}

## 章节内容
${reviewContent}

---

请从以下维度评分（1-10分，6分及格），并指出具体问题：

1. **情节完成度**：本章是否完成了大纲中要求的关键场景？是否有遗漏？
2. **角色一致性**：角色的言行是否符合其性格和当前状态？对话是否有区分度？
3. **上下文连贯性**：与前文的衔接是否自然？是否有逻辑矛盾或时间线错误？
4. **文笔质量**：描写是否生动？是否过于平淡或过于矫饰？节奏是否合理？对话是否自然？
5. **吸引力**：作为读者，你会想继续读下去吗？开头是否抓人？结尾是否有钩子？

请严格按以下 JSON 格式输出（不要输出任何其他文字）：

{
  "scores": {
    "plotCompletion": 8,
    "characterConsistency": 7,
    "contextCoherence": 9,
    "writingQuality": 8,
    "attractiveness": 7
  },
  "overallScore": 7.8,
  "issues": ["具体问题1：详细描述哪里不好", "具体问题2：引用原文说明"],
  "highlights": ["写得好的地方"],
  "rewriteAdvice": "如果不重写，最需要改进的是什么；如果重写，应该重点调整哪里"
}`;
}

export function parseReviewResult(raw: string): ReviewResult {
  try {
    // 提取 JSON
    const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    let jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : raw;

    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      jsonStr = jsonStr.slice(start, end + 1);
    }
    jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');

    const data = JSON.parse(jsonStr);

    return {
      overallScore: data.overallScore || 0,
      scores: {
        plotCompletion: data.scores?.plotCompletion || 0,
        characterConsistency: data.scores?.characterConsistency || 0,
        contextCoherence: data.scores?.contextCoherence || 0,
        writingQuality: data.scores?.writingQuality || 0,
        attractiveness: data.scores?.attractiveness || 0,
      },
      issues: data.issues || [],
      highlights: data.highlights || [],
      rewriteAdvice: data.rewriteAdvice || '',
    };
  } catch {
    return {
      overallScore: 5,
      scores: {
        plotCompletion: 5,
        characterConsistency: 5,
        contextCoherence: 5,
        writingQuality: 5,
        attractiveness: 5,
      },
      issues: ['审查结果解析失败'],
      highlights: [],
      rewriteAdvice: '',
    };
  }
}
