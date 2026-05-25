// Agent 提示词模板

import type { ArcDefinition, ChapterOutline, VolumeOutline, AgentDecision, StoryHealth } from '../config';
import type { WorldState } from '../memory/state';

export function buildAgentDecisionPrompt(
  state: WorldState,
  chapterGlobalIndex: number,
  totalChapters: number,
  arc: ArcDefinition | undefined,
  volume: VolumeOutline,
  chapter: ChapterOutline,
): string {
  const progress = ((chapterGlobalIndex / totalChapters) * 100).toFixed(0);

  // 伏笔状态
  const unresolvedForeshadows = state.foreshadows
    .filter(f => !f.resolved)
    .sort((a, b) => a.plantedInChapter - b.plantedInChapter);
  const agedForeshadows = unresolvedForeshadows
    .map(f => ({ ...f, age: chapterGlobalIndex - f.plantedInChapter }))
    .filter(f => f.age > 20);

  // 角色状态
  const charList = Object.entries(state.characters)
    .sort((a, b) => b[1].lastAppearance - a[1].lastAppearance);
  const neglectedChars = charList
    .filter(([, c]) => c.status === 'active' && (chapterGlobalIndex - c.lastAppearance) > 15)
    .map(([name, c]) => `${name}（${chapterGlobalIndex - c.lastAppearance}章未出场）`);

  return `你是一位资深小说编辑，负责为一部 ${totalChapters} 章的超长篇小说制定每章的写作策略。

## 当前进度
- 总进度：第 ${chapterGlobalIndex + 1}/${totalChapters} 章（${progress}%）
- 当前卷：第 ${volume.volumeIndex + 1} 卷「${volume.title}」
- 当前章：${chapter.title} — ${chapter.summary}
${arc ? `- 当前篇：${arc.title}（卷 ${arc.volumeRange.start + 1}-${arc.volumeRange.end + 1}）` : ''}

## 章节大纲要求
- 出场角色：${chapter.characters.join('、')}
- 情绪基调：${chapter.mood}
- 关键场景：${chapter.keyScenes.join('；')}
${chapter.cliffhanger ? `- 章末悬念：${chapter.cliffhanger}` : ''}

## 角色状态
${charList.slice(0, 15).map(([name, c]) =>
    `- ${name}：${c.currentLocation}，${c.cultivationLevel}，${c.emotionalState}（上次出场：第${c.lastAppearance + 1}章）`
  ).join('\n')}

## 未回收伏笔（${unresolvedForeshadows.length}个）
${unresolvedForeshadows.slice(0, 15).map(f =>
    `- [${f.priority}] 第${f.plantedInChapter + 1}章埋下：${f.description}`
  ).join('\n') || '无'}

${agedForeshadows.length > 0 ? `## ⚠️ 伏笔老化警告\n${agedForeshadows.map(f => `- "${f.description}" 已 ${f.age} 章未回收！`).join('\n')}` : ''}

${neglectedChars.length > 0 ? `## ⚠️ 角色消失警告\n${neglectedChars.join('、')}已太久未出场` : ''}

---

请制定本章的写作策略，严格按以下 JSON 格式输出：

{
  "featuredCharacters": ["建议重点刻画的角色名"],
  "pacing": "fast/medium/slow",
  "plotFocus": "main/subplot/character/worldbuilding",
  "foreshadowsToPlant": ["建议本章埋下的新伏笔描述（如有）"],
  "foreshadowsToResolve": ["需要在本章回收的伏笔描述"],
  "tone": "本章基调",
  "mood": "本章情绪",
  "emphasis": ["具体的写作指导意见"]
}`;
}

export function parseAgentDecision(raw: string, chapterGlobalIndex: number): AgentDecision {
  try {
    const jsonStr = extractJSON(raw);
    const data = JSON.parse(jsonStr);
    return {
      chapterGlobalIndex,
      timestamp: new Date().toISOString(),
      featuredCharacters: data.featuredCharacters || [],
      pacing: data.pacing || 'medium',
      plotFocus: data.plotFocus || 'main',
      foreshadowsToPlant: data.foreshadowsToPlant || [],
      foreshadowsToResolve: data.foreshadowsToResolve || [],
      tone: data.tone || '',
      mood: data.mood || '',
      emphasis: data.emphasis || [],
    };
  } catch {
    return {
      chapterGlobalIndex,
      timestamp: new Date().toISOString(),
      featuredCharacters: [],
      pacing: 'medium',
      plotFocus: 'main',
      foreshadowsToPlant: [],
      foreshadowsToResolve: [],
      tone: '',
      mood: '',
      emphasis: [],
    };
  }
}

export function buildStoryHealthPrompt(
  state: WorldState,
  chapterGlobalIndex: number,
  totalChapters: number,
  healthIssues: string[],
): string {
  return `请分析以下故事健康问题并给出修正建议。

## 当前状态
- 进度：第 ${chapterGlobalIndex + 1}/${totalChapters} 章
- 未回收伏笔：${state.foreshadows.filter(f => !f.resolved).length} 个
- 活跃角色：${Object.values(state.characters).filter(c => c.status === 'active').length} 个

## 检测到的问题
${healthIssues.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}

---

请严格按以下 JSON 格式输出：
{
  "foreshadowBacklog": 0,
  "characterNeglect": ["需要重新安排出场的角色"],
  "pacingAssessment": "too_fast/too_slow/good",
  "consistencyWarnings": ["一致性警告"],
  "recommendations": ["具体的修正建议"]
}`;
}

export function parseStoryHealth(raw: string): StoryHealth {
  try {
    const jsonStr = extractJSON(raw);
    const data = JSON.parse(jsonStr);
    return {
      foreshadowBacklog: data.foreshadowBacklog || 0,
      characterNeglect: data.characterNeglect || [],
      pacingAssessment: data.pacingAssessment || 'good',
      consistencyWarnings: data.consistencyWarnings || [],
      recommendations: data.recommendations || [],
    };
  } catch {
    return {
      foreshadowBacklog: 0,
      characterNeglect: [],
      pacingAssessment: 'good',
      consistencyWarnings: [],
      recommendations: [],
    };
  }
}

function extractJSON(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  let raw = codeBlockMatch ? codeBlockMatch[1].trim() : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    raw = raw.slice(start, end + 1);
  }
  return raw.replace(/,\s*([\]}])/g, '$1').trim();
}
