// 章节摘要管理

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ProjectManager } from '../config';

export interface ChapterSummary {
  chapterIndex: number;
  title: string;
  plotProgress: string;
  characterChanges: string[];
  newInformation: string[];
  endingHook: string;
  narrativeSummary: string; // 200-300字叙事摘要，给 LLM 看的
}

export function loadSummaries(pm: ProjectManager): Record<number, ChapterSummary> {
  const path = join(pm.projectDir, 'summaries.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveSummaries(pm: ProjectManager, summaries: Record<number, ChapterSummary>): void {
  const path = join(pm.projectDir, 'summaries.json');
  writeFileSync(path, JSON.stringify(summaries, null, 2), 'utf-8');
}

export function saveSummary(pm: ProjectManager, chapterIndex: number, summary: ChapterSummary): void {
  const all = loadSummaries(pm);
  all[chapterIndex] = summary;
  saveSummaries(pm, all);
}

/**
 * 获取最近 N 章的摘要文本（用于注入 prompt）
 */
export function getRecentSummariesText(
  summaries: Record<number, ChapterSummary>,
  currentChapterIndex: number,
  count: number = 5,
): string {
  const parts: string[] = [];
  const start = Math.max(0, currentChapterIndex - count);

  for (let i = start; i < currentChapterIndex; i++) {
    const s = summaries[i];
    if (s) {
      parts.push(`### 第${i + 1}章「${s.title}」摘要\n${s.narrativeSummary}`);
    }
  }

  return parts.length > 0 ? `## 前文摘要\n${parts.join('\n\n')}` : '';
}

/**
 * 摘要生成 prompt
 */
export function buildSummaryExtractionPrompt(chapterTitle: string, chapterContent: string): string {
  return `请从以下章节内容中提取结构化摘要。

## 章节：${chapterTitle}

${chapterContent.slice(0, 8000)}

---

请严格按以下 JSON 格式输出：

{
  "plotProgress": "本章情节推进了什么（一句话）",
  "characterChanges": ["角色1：发生了什么变化", "角色2：发生了什么变化"],
  "newInformation": ["揭示了什么新信息1", "揭示了什么新信息2"],
  "endingHook": "章末悬念是什么",
  "narrativeSummary": "200-300字的叙事摘要，概括本章主要情节"
}`;
}
