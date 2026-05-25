// 全局状态管理 — 追踪写作过程中的"活"信息

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ProjectManager } from '../config';

export interface CharacterState {
  currentLocation: string;
  cultivationLevel: string;
  emotionalState: string;
  knownInformation: string[];
  lastAppearance: number;
  status: 'active' | 'absent' | 'dead' | 'unknown';
}

export interface TimelineEvent {
  chapterIndex: number;
  event: string;
  impact: string;
}

export interface Foreshadow {
  id: string;
  description: string;
  plantedInChapter: number;
  resolved: boolean;
  resolvedInChapter?: number;
  priority: 'high' | 'medium' | 'low';
}

export interface OpeningRecord {
  chapterIndex: number;
  firstSentence: string;
  openingType: string;
}

export interface WorldState {
  characters: Record<string, CharacterState>;
  timeline: TimelineEvent[];
  foreshadows: Foreshadow[];
  recentOpenings: OpeningRecord[];
  lastUpdatedChapter: number;
}

const EMPTY_STATE: WorldState = {
  characters: {},
  timeline: [],
  foreshadows: [],
  recentOpenings: [],
  lastUpdatedChapter: -1,
};

export function loadState(pm: ProjectManager): WorldState {
  const path = join(pm.projectDir, 'state.json');
  if (!existsSync(path)) return { ...EMPTY_STATE };
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function saveState(pm: ProjectManager, state: WorldState): void {
  const path = join(pm.projectDir, 'state.json');
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * 从 LLM 提取结果更新 state
 */
export function applyStateUpdate(
  state: WorldState,
  update: StateUpdate,
  chapterIndex: number,
): void {
  // 更新角色状态
  if (update.characters) {
    for (const [name, charUpdate] of Object.entries(update.characters)) {
      if (!state.characters[name]) {
        state.characters[name] = {
          currentLocation: '未知',
          cultivationLevel: '未知',
          emotionalState: '未知',
          knownInformation: [],
          lastAppearance: chapterIndex,
          status: 'active',
        };
      }
      const c = state.characters[name];
      if (charUpdate.location) c.currentLocation = charUpdate.location;
      if (charUpdate.cultivationLevel) c.cultivationLevel = charUpdate.cultivationLevel;
      if (charUpdate.emotionalState) c.emotionalState = charUpdate.emotionalState;
      if (charUpdate.newInformation) {
        for (const info of charUpdate.newInformation) {
          if (!c.knownInformation.includes(info)) {
            c.knownInformation.push(info);
          }
        }
        // 限制每个角色的已知信息数量
        if (c.knownInformation.length > 20) {
          c.knownInformation = c.knownInformation.slice(-20);
        }
      }
      if (charUpdate.status) c.status = charUpdate.status;
      c.lastAppearance = chapterIndex;
    }
  }

  // 更新时间线
  if (update.events) {
    for (const ev of update.events) {
      state.timeline.push({
        chapterIndex,
        event: ev.event,
        impact: ev.impact || '',
      });
    }
  }

  // 更新伏笔
  if (update.newForeshadows) {
    for (let i = 0; i < update.newForeshadows.length; i++) {
      const desc = update.newForeshadows[i];
      state.foreshadows.push({
        id: `f_${chapterIndex}_${i}`,
        description: desc,
        plantedInChapter: chapterIndex,
        resolved: false,
        priority: 'medium',
      });
    }
  }
  if (update.resolvedForeshadows) {
    for (const desc of update.resolvedForeshadows) {
      const unresolved = state.foreshadows.filter(f => !f.resolved);
      const match = unresolved.find(f =>
        f.description.includes(desc) || desc.includes(f.description)
      );
      if (match) {
        match.resolved = true;
        match.resolvedInChapter = chapterIndex;
      }
    }
  }

  // 更新开头记录
  if (update.openingType) {
    const content = update.firstSentence || '';
    state.recentOpenings.push({
      chapterIndex,
      firstSentence: content,
      openingType: update.openingType,
    });
    if (state.recentOpenings.length > 10) {
      state.recentOpenings = state.recentOpenings.slice(-10);
    }
  }

  // 清理已解决且过旧的伏笔，防止无限增长
  pruneState(state, chapterIndex);

  state.lastUpdatedChapter = chapterIndex;
}

/**
 * 清理状态中过旧的数据，防止无限增长
 */
function pruneState(state: WorldState, currentChapter: number): void {
  // 保留未回收伏笔 + 最近 10 章内回收的伏笔，删除更早的已回收伏笔
  state.foreshadows = state.foreshadows.filter(f =>
    !f.resolved || (f.resolvedInChapter !== undefined && f.resolvedInChapter >= currentChapter - 10)
  );

  // 时间线只保留最近 30 章的事件
  if (state.timeline.length > 60) {
    state.timeline = state.timeline.filter(e => e.chapterIndex >= currentChapter - 30);
  }
}

/**
 * 为 prompt 构建状态上下文
 */
export function buildStateContext(state: WorldState, currentChapterIndex: number): string {
  const parts: string[] = [];

  // 角色状态
  const activeChars = Object.entries(state.characters)
    .filter(([, c]) => c.status === 'active')
    .sort((a, b) => b[1].lastAppearance - a[1].lastAppearance);

  if (activeChars.length > 0) {
    parts.push('## 当前角色状态');
    for (const [name, c] of activeChars.slice(0, 15)) {
      const absence = currentChapterIndex - c.lastAppearance;
      const lastSeen = c.lastAppearance >= 0 ? `上次出场：第${c.lastAppearance + 1}章${absence > 15 ? `（${absence}章前）` : ''}` : '尚未出场';
      parts.push(`- **${name}**：${c.currentLocation}，${c.cultivationLevel}，情绪：${c.emotionalState}。${lastSeen}`);
      if (c.knownInformation.length > 0) {
        parts.push(`  已知信息：${c.knownInformation.slice(-3).join('；')}`);
      }
    }
    parts.push('');
  }

  // 未回收的伏笔
  const unresolvedForeshadows = state.foreshadows.filter(f => !f.resolved);
  if (unresolvedForeshadows.length > 0) {
    parts.push('## 未回收的伏笔（请考虑在合适的时机回收）');
    for (const f of unresolvedForeshadows.slice(0, 12)) {
      const age = currentChapterIndex - f.plantedInChapter;
      const ageWarning = age > 30 ? `（已${age}章未回收⚠️）` : '';
      parts.push(`- [${f.priority}优] 第${f.plantedInChapter + 1}章埋下：${f.description}${ageWarning}`);
    }
    parts.push('');
  }

  // 最近的开头模式
  const recentOpenings = state.recentOpenings.slice(-5);
  if (recentOpenings.length > 0) {
    parts.push('## 最近的章节开头模式（请避免重复）');
    for (const o of recentOpenings) {
      parts.push(`- 第${o.chapterIndex + 1}章：[${o.openingType}] ${o.firstSentence.slice(0, 30)}...`);
    }
    const recentTypes = recentOpenings.map(o => o.openingType);
    const avoidTypes = [...new Set(recentTypes.filter(t => recentTypes.filter(t2 => t2 === t).length >= 2))];
    if (avoidTypes.length > 0) {
      parts.push(`→ 请避免使用${avoidTypes.map(t => `"${t}"`).join('、')}类开头`);
    }
    parts.push('');
  }

  // 消失角色警告
  const neglectedChars = activeChars.filter(([, c]) =>
    c.status === 'active' && (currentChapterIndex - c.lastAppearance) > 30
  );
  if (neglectedChars.length > 0) {
    parts.push('## ⚠️ 长期未出场角色（请考虑安排回归）');
    for (const [name, c] of neglectedChars) {
      parts.push(`- **${name}**：已 ${currentChapterIndex - c.lastAppearance} 章未出场，最后位置：${c.currentLocation}`);
    }
    parts.push('');
  }

  // 最近的关键事件
  const recentEvents = state.timeline.filter(e => e.chapterIndex >= currentChapterIndex - 5);
  if (recentEvents.length > 0) {
    parts.push('## 最近的关键事件');
    for (const e of recentEvents.slice(-5)) {
      parts.push(`- 第${e.chapterIndex + 1}章：${e.event}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

// LLM 返回的状态更新格式
export interface StateUpdate {
  characters?: Record<string, {
    location?: string;
    cultivationLevel?: string;
    emotionalState?: string;
    newInformation?: string[];
    status?: 'active' | 'absent' | 'dead' | 'unknown';
  }>;
  events?: { event: string; impact?: string }[];
  newForeshadows?: string[];
  resolvedForeshadows?: string[];
  openingType?: string;
  firstSentence?: string;
}
