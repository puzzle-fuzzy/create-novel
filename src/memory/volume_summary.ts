// 卷级摘要管理

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ProjectManager, VolumeSummary } from '../config';
import { generateWithRetry } from '../llm';
import { extractJSON } from '../utils';

export function loadVolumeSummaries(pm: ProjectManager): Record<number, VolumeSummary> {
  const path = join(pm.volumeSummariesDir, 'volume_summaries.json');
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return {}; }
}

export function saveVolumeSummary(pm: ProjectManager, summary: VolumeSummary): void {
  pm.ensureDirs();
  const all = loadVolumeSummaries(pm);
  all[summary.volumeIndex] = summary;
  const path = join(pm.volumeSummariesDir, 'volume_summaries.json');
  writeFileSync(path, JSON.stringify(all, null, 2), 'utf-8');
}

export async function generateVolumeSummary(
  pm: ProjectManager,
  volumeIndex: number,
  arcIndex: number,
): Promise<VolumeSummary> {
  const outline = pm.loadOutline();
  const vol = outline.volumes[volumeIndex];

  // 收集本卷所有章节摘要
  const summaries = await import('./summaries').then(m => m.loadSummaries(pm));
  const chapterSummaries: string[] = [];
  for (const ch of vol.chapters) {
    const s = summaries[ch.globalIndex];
    if (s) {
      chapterSummaries.push(`第${ch.globalIndex + 1}章「${ch.title}」：${s.narrativeSummary}`);
    }
  }

  const prompt = `请根据以下信息生成本卷的结构化摘要。

## 卷信息
标题：${vol.title}
概述：${vol.summary}
总章数：${vol.chapters.length}

## 各章摘要
${chapterSummaries.join('\n')}

---

请严格按以下 JSON 格式输出：
{
  "summary": "500-800字的卷级摘要，概括本卷的主要情节、角色发展和关键转折",
  "characterDevelopments": ["角色1在本卷的变化", "角色2在本卷的变化"],
  "keyEvents": ["关键事件1", "关键事件2", "关键事件3"],
  "unresolvedForeshadows": ["本卷结束时仍未回收的伏笔"],
  "toneAndPacing": "本卷的节奏评估（如：前半铺垫较慢，后半节奏紧凑）"
}`;

  const result = await generateWithRetry({
    systemPrompt: '你是一位小说编辑，擅长概括和分析长篇故事的结构。请按 JSON 格式输出。',
    userPrompt: prompt,
    model: process.env.LLM_WRITER_MODEL || undefined,
    temperature: 0.3,
    maxTokens: 2048,
  });

  try {
    const jsonStr = extractJSON(result.content);
    const data = JSON.parse(jsonStr);
    return {
      volumeIndex,
      arcIndex,
      title: vol.title,
      summary: data.summary || '',
      characterDevelopments: data.characterDevelopments || [],
      keyEvents: data.keyEvents || [],
      unresolvedForeshadows: data.unresolvedForeshadows || [],
      toneAndPacing: data.toneAndPacing || '',
    };
  } catch {
    return {
      volumeIndex,
      arcIndex,
      title: vol.title,
      summary: vol.summary,
      characterDevelopments: [],
      keyEvents: [],
      unresolvedForeshadows: [],
      toneAndPacing: '',
    };
  }
}
