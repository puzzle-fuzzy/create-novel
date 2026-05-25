// 篇（Arc）级摘要管理

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ProjectManager, ArcSummary, ArcDefinition } from '../config';
import { generateWithRetry } from '../llm';
import { extractJSON } from '../utils';
import { loadVolumeSummaries } from './volume_summary';

export function loadArcSummaries(pm: ProjectManager): Record<number, ArcSummary> {
  const path = join(pm.arcSummariesDir, 'arc_summaries.json');
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return {}; }
}

export function saveArcSummary(pm: ProjectManager, summary: ArcSummary): void {
  pm.ensureDirs();
  const all = loadArcSummaries(pm);
  all[summary.arcIndex] = summary;
  const path = join(pm.arcSummariesDir, 'arc_summaries.json');
  writeFileSync(path, JSON.stringify(all, null, 2), 'utf-8');
}

export async function generateArcSummary(
  pm: ProjectManager,
  arc: ArcDefinition,
): Promise<ArcSummary> {
  const volSummaries = loadVolumeSummaries(pm);

  // 收集本篇所有卷摘要
  const parts: string[] = [];
  for (let v = arc.volumeRange.start; v <= arc.volumeRange.end; v++) {
    const vs = volSummaries[v];
    if (vs) {
      parts.push(`第${v + 1}卷「${vs.title}」：${vs.summary}`);
    }
  }

  const prompt = `请根据以下信息生成本篇（Arc）的结构化摘要。

## 篇信息
标题：${arc.title}
卷范围：第${arc.volumeRange.start + 1}卷 ~ 第${arc.volumeRange.end + 1}卷
子冲突：${arc.subConflict}
高潮：${arc.climax}
结局：${arc.resolution}

## 各卷摘要
${parts.join('\n\n')}

---

请严格按以下 JSON 格式输出：
{
  "summary": "800-1200字的篇级摘要，概括整篇的故事走向、角色成长和主题升华",
  "characterStatusSnapshots": {
    "角色名": {
      "location": "当前所在",
      "status": "当前状态描述",
      "keyChanges": ["本篇中的关键变化1", "关键变化2"]
    }
  },
  "resolvedForeshadows": ["本篇中回收的伏笔"],
  "unresolvedForeshadows": ["本篇结束时仍未回收的伏笔"],
  "plotAdvancement": "主线剧情推进了什么"
}`;

  const result = await generateWithRetry({
    systemPrompt: '你是一位小说分析师，擅长概括超长篇小说的宏观结构。请按 JSON 格式输出。',
    userPrompt: prompt,
    model: process.env.LLM_PLANNER_MODEL || process.env.LLM_WRITER_MODEL || undefined,
    temperature: 0.3,
    maxTokens: 4096,
  });

  try {
    const jsonStr = extractJSON(result.content);
    const data = JSON.parse(jsonStr);
    return {
      arcIndex: arc.arcIndex,
      volumeRange: arc.volumeRange,
      summary: data.summary || '',
      characterStatusSnapshots: data.characterStatusSnapshots || {},
      resolvedForeshadows: data.resolvedForeshadows || [],
      unresolvedForeshadows: data.unresolvedForeshadows || [],
      plotAdvancement: data.plotAdvancement || '',
    };
  } catch {
    return {
      arcIndex: arc.arcIndex,
      volumeRange: arc.volumeRange,
      summary: parts.join('\n'),
      characterStatusSnapshots: {},
      resolvedForeshadows: [],
      unresolvedForeshadows: [],
      plotAdvancement: '',
    };
  }
}
