// 提示词模板 - 章节内容生成

import type { NovelConfig, ChapterOutline, VolumeOutline } from '../config';

/**
 * 构建章节写作的系统提示词
 */
export function buildChapterSystemPrompt(config: NovelConfig): string {
  const { writingStyle, worldSetting } = config;

  return `你是一位才华横溢的${worldSetting.genre}小说作家。你现在正在创作一部长篇小说。

## 写作要求
- **叙事视角**：${writingStyle.perspective}
- **文笔风格**：${writingStyle.proseStyle}
- **对话占比**：${writingStyle.dialogueRatio}
- **基调**：${worldSetting.tone}

## 写作原则
1. 用生动的细节和描写让场景栩栩如生
2. 通过角色的行动和对话展现性格，而非直接说明
3. 保持紧凑的节奏，每一章都要推动剧情发展
4. 在章节结尾留下钩子，让读者欲罢不能
5. 注意五感描写：视觉、听觉、触觉、嗅觉、味觉
6. 对话要有角色特色，不同角色的说话方式要有区分
7. 适当使用环境描写烘托氛围
8. 内心独白要真实自然，展现角色思考过程
9. 避免说教，让读者自己体会
10. 控制信息量，不要一次倾倒太多设定

## 字数要求
- 本章目标字数：${writingStyle.chapterLength} 字左右
- 不要为了凑字数而注水，也不要写得太简略
- 宁可多写也不要少写，充分展开每个场景

请直接输出小说正文内容，不要添加任何说明、注释或元信息。`;
}

/**
 * 构建章节写作的用户提示词
 */
export function buildChapterUserPrompt(
  config: NovelConfig,
  worldBible: string,
  volume: VolumeOutline,
  chapter: ChapterOutline,
  previousChapterSummary?: string,
  previousChapterTail?: string,
): string {
  const parts: string[] = [];

  // 世界设定（精简版）
  parts.push(`## 世界设定摘要\n${worldBible.slice(0, 3000)}\n`);

  // 本卷信息
  parts.push(`## 当前卷：${volume.title}\n${volume.summary}`);

  // 章节大纲
  parts.push(`## 本章大纲：第${chapter.globalIndex + 1}章 - ${chapter.title}
${chapter.summary}

关键场景：
${chapter.keyScenes.map((s, i) => `${i + 1}. ${s}`).join('\n')}

出场角色：${chapter.characters.join('、')}
情绪基调：${chapter.mood}
${chapter.cliffhanger ? `章末悬念：${chapter.cliffhanger}` : ''}`);

  // 前文衔接
  if (previousChapterSummary) {
    parts.push(`## 上一章概要\n${previousChapterSummary}`);
  }

  if (previousChapterTail) {
    parts.push(`## 上一章结尾（用于衔接）\n${previousChapterTail}`);
  }

  // 写作指令
  parts.push(`## 写作指令
请根据以上信息，创作第 ${chapter.globalIndex + 1} 章「${chapter.title}」的完整内容。

要求：
1. 目标字数：${chapter.targetWords} 字左右
2. ${previousChapterTail ? '自然衔接上一章结尾' : '这是一个好的开篇，引人入胜'}
3. 充分展开每个关键场景
4. 保持角色性格一致
5. 注意场景转换的自然过渡
6. 章节结尾${chapter.cliffhanger ? `要留下悬念：「${chapter.cliffhanger}」` : '要给人余韵'}

直接输出小说正文：`);

  return parts.join('\n\n');
}

/**
 * 构建章节摘要生成的提示词
 */
export function buildSummaryPrompt(chapterTitle: string, chapterContent: string): string {
  return `请为以下章节内容生成一份 200-300 字的摘要，要求：
1. 概括主要情节
2. 记录关键信息揭示
3. 标注角色状态变化
4. 注意伏笔和细节

## 章节：${chapterTitle}

${chapterContent}

---

请输出摘要：`;
}

/**
 * 提取章节尾部用于衔接
 */
export function extractTail(content: string, maxChars: number = 800): string {
  if (content.length <= maxChars) return content;
  return content.slice(-maxChars);
}
