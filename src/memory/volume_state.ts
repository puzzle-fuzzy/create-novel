// 每卷状态快照 + 运行状态修剪

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ProjectManager } from '../config';
import type { WorldState } from './state';

/**
 * 卷完成后保存状态快照（只读，供 Agent 回溯用）
 */
export function snapshotStateAtVolumeEnd(
  pm: ProjectManager,
  state: WorldState,
  volumeIndex: number,
): void {
  pm.ensureDirs();
  const path = join(pm.stateSnapshotsDir, `v${String(volumeIndex + 1).padStart(2, '0')}.json`);
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * 加载某卷的状态快照
 */
export function loadVolumeSnapshot(pm: ProjectManager, volumeIndex: number): WorldState | null {
  const path = join(pm.stateSnapshotsDir, `v${String(volumeIndex + 1).padStart(2, '0')}.json`);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

/**
 * 快照后修剪运行状态，防止 540 章下 state.json 无限膨胀
 * 规则：
 *   - 已解决且超过 2 卷的伏笔 → 删除
 *   - 每个 character 的 knownInformation → 只保留最近 10 条
 *   - timeline → 只保留最近 60 条
 */
export function pruneRuntimeState(state: WorldState, currentChapterIndex: number, chaptersPerVolume: number): void {
  const volumeBoundary = currentChapterIndex - chaptersPerVolume * 2;

  // 修剪已解决的伏笔
  state.foreshadows = state.foreshadows.filter(f =>
    !f.resolved || (f.resolvedInChapter !== undefined && f.resolvedInChapter >= volumeBoundary)
  );

  // 修剪角色已知信息
  for (const charState of Object.values(state.characters)) {
    if (charState.knownInformation && charState.knownInformation.length > 10) {
      charState.knownInformation = charState.knownInformation.slice(-10);
    }
  }

  // 修剪时间线
  if (state.timeline.length > 60) {
    state.timeline = state.timeline.filter(e => e.chapterIndex >= currentChapterIndex - 60);
  }
}
