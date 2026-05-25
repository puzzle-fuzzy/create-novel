// 编译最终小说

import { ProjectManager } from './config';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export function compileNovel(pm: ProjectManager): void {
  const outline = pm.loadOutline();
  const progress = pm.loadProgress();

  console.log('\n📦 正在编译最终小说...\n');

  const novel = pm.compileNovel();

  // 保存完整 TXT
  const txtPath = join(pm.outputPath, `${outline.novelTitle}.txt`);
  writeFileSync(txtPath, novel, 'utf-8');
  console.log(`  ✅ 完整版已保存：${txtPath}`);
  console.log(`  📊 总字数：${novel.length}`);

  // 分卷输出（对于长篇小说更实用）
  if (outline.totalVolumes > 5) {
    console.log(`\n  📦 正在生成分卷文件...`);
    const volumesDir = join(pm.outputPath, 'volumes');
    if (!existsSync(volumesDir)) mkdirSync(volumesDir, { recursive: true });

    const chapterFiles = pm.getCompletedChapterFiles();
    const volumeContents: Map<number, string> = new Map();

    for (const file of chapterFiles) {
      const vIdx = parseInt(file.match(/v(\d+)/)?.[1] || '0') - 1;
      const cIdx = parseInt(file.match(/c(\d+)/)?.[1] || '0') - 1;
      const content = readFileSync(join(pm.chaptersDir, file), 'utf-8');
      const chapter = outline.volumes[vIdx]?.chapters[cIdx];

      let volText = volumeContents.get(vIdx) || '';
      if (chapter) {
        volText += `${'─'.repeat(40)}\n  第${chapter.globalIndex + 1}章：${chapter.title}\n${'─'.repeat(40)}\n\n`;
      }
      volText += content + '\n\n';
      volumeContents.set(vIdx, volText);
    }

    for (const [vIdx, volText] of volumeContents) {
      const vol = outline.volumes[vIdx];
      const volFileName = `v${String(vIdx + 1).padStart(2, '0')}_${vol?.title || '未知'}.txt`;
      writeFileSync(join(volumesDir, volFileName), volText, 'utf-8');
    }
    console.log(`  ✅ 已生成 ${volumeContents.size} 个分卷文件到 ${volumesDir}`);
  }

  // 统计报告
  const stats = generateStats(pm, outline, progress, novel.length);
  const statsPath = join(pm.outputPath, 'stats.txt');
  writeFileSync(statsPath, stats, 'utf-8');
  console.log(`  📈 统计报告：${statsPath}`);
}

function generateStats(
  pm: ProjectManager,
  outline: any,
  progress: any,
  totalChars: number,
): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════');
  lines.push(`  《${outline.novelTitle}》 生成统计报告`);
  lines.push('═══════════════════════════════════════');
  lines.push('');
  lines.push(`总卷数：${outline.totalVolumes}`);
  lines.push(`总章数：${outline.totalChapters}`);
  lines.push(`总字数：${totalChars}（${(totalChars / 10000).toFixed(1)}万字）`);
  lines.push(`目标字数：${outline.estimatedWords}（${(outline.estimatedWords / 10000).toFixed(1)}万字）`);
  lines.push(`完成率：${(totalChars / outline.estimatedWords * 100).toFixed(1)}%`);
  lines.push(`总 Token 消耗：${progress.totalTokensUsed}`);
  if (progress.completedArcs) lines.push(`完成篇数：${progress.completedArcs}`);
  lines.push(`开始时间：${progress.startedAt}`);
  lines.push(`完成时间：${progress.updatedAt}`);
  lines.push('');
  lines.push('── 各卷字数 ──');

  const chapterFiles = pm.getCompletedChapterFiles();
  let currentVolume = -1;
  let volumeWords = 0;
  let volumeChapters = 0;
  const volumeStats: { name: string; words: number; chapters: number; arcIndex?: number }[] = [];

  for (const file of chapterFiles) {
    const vIdx = parseInt(file.match(/v(\d+)/)?.[1] || '0') - 1;
    const content = readFileSync(join(pm.chaptersDir, file), 'utf-8');

    if (vIdx !== currentVolume) {
      if (currentVolume >= 0 && volumeStats.length > 0) {
        volumeStats[volumeStats.length - 1].words = volumeWords;
        volumeStats[volumeStats.length - 1].chapters = volumeChapters;
      }
      currentVolume = vIdx;
      volumeWords = 0;
      volumeChapters = 0;
      const vol = vIdx < outline.volumes.length ? outline.volumes[vIdx] : null;
      volumeStats.push({
        name: `第${vIdx + 1}卷：${vol?.title || '未知'}`,
        words: 0,
        chapters: 0,
        arcIndex: vol?.arcIndex,
      });
    }

    volumeWords += content.length;
    volumeChapters++;
  }

  if (volumeStats.length > 0) {
    volumeStats[volumeStats.length - 1].words = volumeWords;
    volumeStats[volumeStats.length - 1].chapters = volumeChapters;
  }

  // 按篇分组显示
  let lastArc = -1;
  for (const vs of volumeStats) {
    if (vs.arcIndex !== undefined && vs.arcIndex !== lastArc) {
      lines.push(`\n  ── 篇${(vs.arcIndex || 0) + 1} ──`);
      lastArc = vs.arcIndex || 0;
    }
    lines.push(`  ${vs.name}：${vs.chapters} 章，${vs.words} 字（${(vs.words / 10000).toFixed(1)}万字）`);
  }

  return lines.join('\n');
}
