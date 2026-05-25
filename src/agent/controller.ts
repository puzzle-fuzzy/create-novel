// Agent 控制器 — 小说写作的"大脑"

import type { ProjectManager, ArcDefinition, ChapterOutline, VolumeOutline, AgentDecision, StoryHealth } from '../config';
import type { WorldState } from '../memory/state';
import { generateWithRetry } from '../llm';
import { buildAgentDecisionPrompt, parseAgentDecision, buildStoryHealthPrompt, parseStoryHealth } from './prompts';

const MAX_FORESHADOW_AGE = 50;
const MAX_CHARACTER_ABSENCE = 30;

/**
 * 写前决策：Agent 审视当前状态，制定本章写作策略
 */
export async function makeChapterDecision(
  pm: ProjectManager,
  state: WorldState,
  chapterGlobalIndex: number,
  totalChapters: number,
  arc: ArcDefinition | undefined,
  volume: VolumeOutline,
  chapter: ChapterOutline,
): Promise<AgentDecision> {
  const agentModel = process.env.LLM_AGENT_MODEL;
  if (!agentModel) {
    // 无 Agent 模型时返回默认决策
    return defaultDecision(chapterGlobalIndex, chapter);
  }

  const prompt = buildAgentDecisionPrompt(state, chapterGlobalIndex, totalChapters, arc, volume, chapter);

  try {
    const result = await generateWithRetry({
      systemPrompt: '你是一位经验丰富的超长篇小说编辑顾问。你需要根据当前故事状态，为即将写作的章节制定精确的策略。请按 JSON 格式输出。',
      userPrompt: prompt,
      model: agentModel,
      temperature: 0.4,
      maxTokens: 2048,
    });

    const decision = parseAgentDecision(result.content, chapterGlobalIndex);
    pm.saveAgentDecision(decision);
    return decision;
  } catch (e: any) {
    console.warn(`  ⚠️ Agent 决策失败：${e.message}，使用默认策略`);
    return defaultDecision(chapterGlobalIndex, chapter);
  }
}

/**
 * 写后评估：检查故事健康状态
 * 优先使用纯代码计算，仅在检测到异常时才调用 LLM
 */
export async function evaluateStoryHealth(
  pm: ProjectManager,
  state: WorldState,
  chapterGlobalIndex: number,
  totalChapters: number,
): Promise<StoryHealth | null> {
  const issues: string[] = [];

  // 伏笔积压检查
  const unresolved = state.foreshadows.filter(f => !f.resolved);
  const aged = unresolved.filter(f => (chapterGlobalIndex - f.plantedInChapter) > MAX_FORESHADOW_AGE);
  if (aged.length > 0) {
    issues.push(`有 ${aged.length} 个伏笔超过 ${MAX_FORESHADOW_AGE} 章未回收：${aged.map(f => `"${f.description}"（${chapterGlobalIndex - f.plantedInChapter}章）`).join('；')}`);
  }
  if (unresolved.length > 15) {
    issues.push(`未回收伏笔总数达到 ${unresolved.length}，可能造成读者困惑`);
  }

  // 角色消失检查
  const neglected = Object.entries(state.characters)
    .filter(([, c]) => c.status === 'active' && (chapterGlobalIndex - c.lastAppearance) > MAX_CHARACTER_ABSENCE)
    .map(([name, c]) => `${name}（${chapterGlobalIndex - c.lastAppearance}章未出场）`);
  if (neglected.length > 0) {
    issues.push(`有 ${neglected.length} 个活跃角色超过 ${MAX_CHARACTER_ABSENCE} 章未出场：${neglected.join('；')}`);
  }

  if (issues.length === 0) return null;

  // 有问题时，尝试调用 LLM 获取修正建议
  const agentModel = process.env.LLM_AGENT_MODEL;
  if (!agentModel) {
    return {
      foreshadowBacklog: aged.length,
      characterNeglect: neglected,
      pacingAssessment: 'good',
      consistencyWarnings: issues,
      recommendations: [],
    };
  }

  try {
    const result = await generateWithRetry({
      systemPrompt: '你是一位小说编辑，擅长诊断长篇小说的结构问题。请按 JSON 格式输出。',
      userPrompt: buildStoryHealthPrompt(state, chapterGlobalIndex, totalChapters, issues),
      model: agentModel,
      temperature: 0.3,
      maxTokens: 1024,
    });
    return parseStoryHealth(result.content);
  } catch {
    return {
      foreshadowBacklog: aged.length,
      characterNeglect: neglected,
      pacingAssessment: 'good',
      consistencyWarnings: issues,
      recommendations: [],
    };
  }
}

function defaultDecision(chapterGlobalIndex: number, chapter: ChapterOutline): AgentDecision {
  return {
    chapterGlobalIndex,
    timestamp: new Date().toISOString(),
    featuredCharacters: chapter.characters.slice(0, 3),
    pacing: 'medium',
    plotFocus: 'main',
    foreshadowsToPlant: [],
    foreshadowsToResolve: [],
    tone: chapter.mood,
    mood: chapter.mood,
    emphasis: [],
  };
}
