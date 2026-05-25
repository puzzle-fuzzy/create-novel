// 层级上下文组装 — 为章节写作 prompt 提供完整的记忆上下文

import type { ProjectManager, ArcDefinition, AgentDecision, VolumeSummary, ArcSummary } from '../config';
import type { WorldState } from './state';
import { loadSummaries, getRecentSummariesText } from './summaries';
import { loadVolumeSummaries } from './volume_summary';
import { loadArcSummaries } from './arc_summary';

const MAX_CONTEXT_CHARS = 20000;

export interface ChapterContext {
  arcSummariesText: string;
  volumeSummariesText: string;
  recentSummariesText: string;
  stateContextText: string;
  agentStrategyText: string;
}

/**
 * 组装章节写作的层级上下文
 */
export function assembleChapterContext(
  pm: ProjectManager,
  chapterGlobalIndex: number,
  currentArc: ArcDefinition | undefined,
  state: WorldState,
  stateContextText: string,
  agentDecision: AgentDecision | undefined,
): ChapterContext {
  const arcSummaries = loadArcSummaries(pm);
  const volumeSummaries = loadVolumeSummaries(pm);

  // 篇摘要：所有已完成篇
  const arcParts: string[] = [];
  if (currentArc) {
    for (const [idx, summary] of Object.entries(arcSummaries)) {
      const arcIdx = parseInt(idx);
      if (arcIdx < currentArc.arcIndex) {
        arcParts.push(`### 篇${arcIdx + 1}「${(summary as ArcSummary).summary?.slice(0, 50) || ''}」\n${(summary as ArcSummary).summary}`);
      }
    }
  }
  const arcSummariesText = arcParts.length > 0
    ? `## 已完成篇摘要\n${arcParts.join('\n\n')}`
    : '';

  // 卷摘要：当前篇中已完成的卷
  const volParts: string[] = [];
  if (currentArc) {
    for (let v = currentArc.volumeRange.start; v <= currentArc.volumeRange.end; v++) {
      const vs = volumeSummaries[v] as VolumeSummary | undefined;
      if (vs) {
        // 只包含当前章之前的卷
        const volLastChapter = findVolumeLastChapterGlobalIndex(pm, v);
        if (volLastChapter !== undefined && volLastChapter < chapterGlobalIndex) {
          volParts.push(`### 第${v + 1}卷「${vs.title}」\n${vs.summary}`);
        }
      }
    }
  }
  const volumeSummariesText = volParts.length > 0
    ? `## 当前篇已完成卷摘要\n${volParts.join('\n\n')}`
    : '';

  // 最近章节摘要（10章）
  const summaries = loadSummaries(pm);
  const recentSummariesText = getRecentSummariesText(summaries, chapterGlobalIndex, 10);

  // Agent 策略
  const agentStrategyText = agentDecision
    ? formatAgentStrategy(agentDecision)
    : '';

  // 估算大小，必要时裁剪
  const totalSize = estimateContextSize(arcSummariesText, volumeSummariesText, recentSummariesText, stateContextText, agentStrategyText);
  let trimmedArc = arcSummariesText;
  let trimmedVol = volumeSummariesText;
  let trimmedRecent = recentSummariesText;

  if (totalSize > MAX_CONTEXT_CHARS) {
    // 优先裁剪：篇摘要 → 卷摘要 → 章节摘要（从最早的开始删）
    if (trimmedArc.length > 0) {
      const budget = MAX_CONTEXT_CHARS - (trimmedVol.length + trimmedRecent.length + stateContextText.length + agentStrategyText.length);
      if (budget > 500) {
        trimmedArc = trimmedArc.slice(0, budget) + '\n\n……（更早的篇摘要省略）';
      } else {
        trimmedArc = '';
      }
    }

    const size2 = trimmedArc.length + trimmedVol.length + trimmedRecent.length + stateContextText.length + agentStrategyText.length;
    if (size2 > MAX_CONTEXT_CHARS && trimmedVol.length > 0) {
      const budget = MAX_CONTEXT_CHARS - (trimmedArc.length + trimmedRecent.length + stateContextText.length + agentStrategyText.length);
      if (budget > 500) {
        trimmedVol = trimmedVol.slice(0, budget) + '\n\n……（省略）';
      } else {
        trimmedVol = '';
      }
    }
  }

  return {
    arcSummariesText: trimmedArc,
    volumeSummariesText: trimmedVol,
    recentSummariesText: trimmedRecent,
    stateContextText,
    agentStrategyText,
  };
}

function formatAgentStrategy(decision: AgentDecision): string {
  const parts: string[] = ['## 本章写作策略（由编辑顾问制定）'];
  parts.push(`- **重点角色**：${decision.featuredCharacters.join('、')}`);
  parts.push(`- **节奏**：${decision.pacing === 'fast' ? '快节奏，紧凑推进' : decision.pacing === 'slow' ? '放缓节奏，深入刻画' : '中等节奏'}`);
  parts.push(`- **焦点**：${decision.plotFocus === 'main' ? '推进主线剧情' : decision.plotFocus === 'subplot' ? '发展支线' : decision.plotFocus === 'character' ? '角色深度刻画' : '世界观展开'}`);
  if (decision.foreshadowsToResolve.length > 0) {
    parts.push(`- **需要回收的伏笔**：${decision.foreshadowsToResolve.join('；')}`);
  }
  if (decision.foreshadowsToPlant.length > 0) {
    parts.push(`- **建议埋下的新伏笔**：${decision.foreshadowsToPlant.join('；')}`);
  }
  parts.push(`- **基调**：${decision.tone}`);
  if (decision.emphasis.length > 0) {
    parts.push(`- **特别要求**：${decision.emphasis.join('；')}`);
  }
  return parts.join('\n');
}

export function estimateContextSize(...texts: string[]): number {
  return texts.reduce((sum, t) => sum + t.length, 0);
}

function findVolumeLastChapterGlobalIndex(pm: ProjectManager, volumeIndex: number): number | undefined {
  try {
    const outline = pm.loadOutline();
    const vol = outline.volumes[volumeIndex];
    if (!vol || vol.chapters.length === 0) return undefined;
    return vol.chapters[vol.chapters.length - 1].globalIndex;
  } catch {
    return undefined;
  }
}
