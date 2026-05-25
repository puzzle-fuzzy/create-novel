// 提示词模板 - 章节内容生成（支持 Agent 决策和篇上下文）

import type { NovelConfig, ChapterOutline, VolumeOutline, AgentDecision } from '../config';

/**
 * 构建章节写作的系统提示词
 */
export function buildChapterSystemPrompt(config: NovelConfig): string {
  const { writingStyle, worldSetting } = config;

  return `你是一位才华横溢的${worldSetting.genre}小说作家，你的作品以人物鲜明、情节紧凑、文笔老练著称。你现在正在创作一部长篇小说。

## 写作要求
- **叙事视角**：${writingStyle.perspective}
- **文笔风格**：${writingStyle.proseStyle}
- **对话占比**：${writingStyle.dialogueRatio}
- **基调**：${worldSetting.tone}

## 写作原则
1. 用生动的细节和描写让场景栩栩如生——要"展示"而非"讲述"
2. 通过角色的行动和对话展现性格，而非直接说明
3. 保持紧凑的节奏，每一章都要推动剧情发展
4. 在章节结尾留下钩子，让读者欲罢不能
5. 注意五感描写：视觉、听觉、触觉、嗅觉、味觉——但不要堆砌，要有目的性地使用
6. 对话要有角色特色，不同角色的说话方式、用词习惯要有区分
7. 环境描写要服务于情绪和氛围，不是单纯写景
8. 内心独白要真实自然，展现角色思考过程
9. 避免说教，让读者自己体会
10. 控制信息量，不要一次倾倒太多设定
11. **【核心】每章的开头方式必须截然不同。已用过的方式：对话开头、环境描写开头、动作开头、声音开头、心理描写开头——都不要重复。尝试：一个出人意料的陈述、一个悬念性问题、一个回忆片段、一个比喻、一个细节特写**

## 字数要求
- 本章目标字数：${writingStyle.chapterLength} 字
- 务必写够字数。宁可多写也不要少写
- 每个场景都要有足够的细节和展开，不要一笔带过
- 一章通常包含 3-5 个完整场景

## 禁忌（绝对不要违反）
- **结尾禁忌**：不要写"一切才刚刚开始""风起云涌""真正的XX才开始""注定不会平静""新的篇章即将开始"等套路句。结尾应该用具体的事件、对话或情感来收束
- **开头禁忌**：不要以天气描写开头（除非是暴雨、冰雹等极端天气且与剧情直接相关），绝对不要用"雨"字开头
- **格式禁忌**：不要输出"(本章完)"、字数统计、章节标记等元信息
- **内容禁忌**：不要让角色突然做出不符合其性格设定的行为

请直接输出小说正文内容。`;
}

/**
 * 构建章节写作的用户提示词（Agent 增强版）
 */
export function buildChapterUserPrompt(
  config: NovelConfig,
  worldBible: string,
  volume: VolumeOutline,
  chapter: ChapterOutline,
  previousChapterSummary: string | undefined,
  previousChapterTail: string | undefined,
  stateContext: string | undefined,
  recentSummariesText: string | undefined,
  qualityFeedback: string[] | undefined,
  reviewAdvice: string | undefined,
  arcTitle: string | undefined,
  arcSummary: string | undefined,
  volumeSummariesText: string | undefined,
  agentStrategy: string | undefined,
): string {
  const parts: string[] = [];

  // 世界设定（截断到 12000 字，支持 200 万字规模的更大世界设定）
  const bibleText = worldBible.length > 12000
    ? smartTruncateWorldBible(worldBible, 12000)
    : worldBible;
  parts.push(`## 世界设定\n${bibleText}\n`);

  // 篇级上下文（如果处于多篇结构中）
  if (arcTitle) {
    parts.push(`## 当前篇：${arcTitle}`);
    if (arcSummary) {
      parts.push(arcSummary);
    }
  }

  // 已完成卷摘要
  if (volumeSummariesText) {
    parts.push(volumeSummariesText);
  }

  // 全局状态上下文
  if (stateContext) {
    parts.push(stateContext);
  }

  // Agent 写作策略
  if (agentStrategy) {
    parts.push(agentStrategy);
  }

  // 本卷信息
  parts.push(`## 当前卷：${volume.title}\n${volume.summary}`);

  // 章节大纲
  parts.push(`## 本章大纲：第${chapter.globalIndex + 1}章 - ${chapter.title}
${chapter.summary}

关键场景（必须全部写到，缺一不可）：
${chapter.keyScenes.map((s, i) => `${i + 1}. ${s}`).join('\n')}

出场角色：${chapter.characters.join('、')}
情绪基调：${chapter.mood}
${chapter.cliffhanger ? `章末悬念：${chapter.cliffhanger}` : ''}`);

  // 前文摘要
  if (recentSummariesText) {
    parts.push(recentSummariesText);
  }

  // 前一章衔接
  if (previousChapterSummary) {
    parts.push(`## 上一章概要\n${previousChapterSummary}`);
  }

  if (previousChapterTail) {
    parts.push(`## 上一章结尾（用于衔接）\n${previousChapterTail}`);
  }

  // 质量反馈
  if (qualityFeedback && qualityFeedback.length > 0) {
    parts.push(`## ⚠️ 上一次生成的问题（必须逐一解决）
${qualityFeedback.map((f, i) => `${i + 1}. ${f}`).join('\n')}`);
  }

  // LLM 审查反馈
  if (reviewAdvice) {
    parts.push(`## 📝 编辑审查意见（请根据这些意见改进写作）
${reviewAdvice}`);
  }

  // 写作指令
  parts.push(`## 写作指令
请根据以上信息，创作第 ${chapter.globalIndex + 1} 章「${chapter.title}」的完整内容。

要求：
1. **字数**：${chapter.targetWords} 字以上，充分展开每个场景
2. **衔接**：${previousChapterTail ? '自然衔接上一章结尾的场景和情绪' : '这是一个引人入胜的开篇'}
3. **场景**：大纲中的每个关键场景都要写到，不能遗漏
4. **角色**：保持角色性格一致，参考上方的角色状态信息
5. **开头**：使用与最近几章截然不同的开篇方式
6. **结尾**：${chapter.cliffhanger ? `留下悬念「${chapter.cliffhanger}」` : '用一个具体的画面、对话或情感收束'}，不要用套路句
7. **节奏**：张弛有度，不要一味紧凑也不要拖沓

直接输出小说正文（不要输出任何前言、说明、标题标记）：`);

  return parts.join('\n\n');
}

/**
 * 智能截断世界设定书
 */
function smartTruncateWorldBible(bible: string, maxChars: number): string {
  if (bible.length <= maxChars) return bible;

  const sectionMarkers = ['角色', '伏笔', '暗线'];
  const sections: { start: number; end: number; content: string }[] = [];

  for (const marker of sectionMarkers) {
    const headerRegex = new RegExp(`^#{1,3}\\s.*${marker}`, 'm');
    const match = headerRegex.exec(bible);
    if (match && match.index > 0) {
      const nextHeader = bible.indexOf('\n## ', match.index + 1);
      const end = nextHeader > match.index ? nextHeader : Math.min(match.index + 2000, bible.length);
      sections.push({
        start: match.index,
        end,
        content: bible.slice(match.index, end),
      });
    }
  }

  const headBudget = Math.floor(maxChars * 0.6);
  let head = bible.slice(0, headBudget);
  const lastParagraph = Math.max(head.lastIndexOf('\n\n'), head.lastIndexOf('\n'));
  if (lastParagraph > headBudget * 0.5) {
    head = head.slice(0, lastParagraph);
  }

  const tailBudget = maxChars - head.length - 50;
  if (sections.length > 0 && tailBudget > 200) {
    const tailParts: string[] = [];
    let usedChars = 0;
    for (const sec of sections) {
      if (usedChars + sec.content.length <= tailBudget) {
        tailParts.push(sec.content);
        usedChars += sec.content.length;
      } else {
        const remaining = tailBudget - usedChars;
        if (remaining > 100) {
          tailParts.push(sec.content.slice(0, remaining) + '\n……（省略）');
          usedChars += remaining;
        }
        break;
      }
    }
    return `${head}\n\n……（中间部分省略）……\n\n${tailParts.join('\n\n')}`;
  }

  return head;
}

/**
 * 提取章节尾部用于衔接
 */
export function extractTail(content: string, maxChars: number = 1500): string {
  if (content.length <= maxChars) return content;
  return content.slice(-maxChars);
}
