// 编译最终小说

import { ProjectManager } from './config';
import { writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export function compileNovel(pm: ProjectManager): void {
  const outline = pm.loadOutline();
  const progress = pm.loadProgress();

  console.log('\n📦 正在编译最终小说...\n');

  const novel = pm.compileNovel();

  // 保存 TXT 格式
  const txtPath = join(pm.outputPath, `${outline.novelTitle}.txt`);
  writeFileSync(txtPath, novel, 'utf-8');
  console.log(`  ✅ TXT 已保存：${txtPath}`);
  console.log(`  📊 总字数：${novel.length}`);

  // 生成统计报告
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
  lines.push(`总字数：${totalChars}`);
  lines.push(`目标字数：${outline.estimatedWords}`);
  lines.push(`完成率：${(totalChars / outline.estimatedWords * 100).toFixed(1)}%`);
  lines.push(`总 Token 消耗：${progress.totalTokensUsed}`);
  lines.push(`开始时间：${progress.startedAt}`);
  lines.push(`完成时间：${progress.updatedAt}`);
  lines.push('');
  lines.push('── 各卷字数 ──');

  const chapterFiles = pm.getCompletedChapterFiles();
  let currentVolume = -1;
  let volumeWords = 0;
  let volumeChapters = 0;
  const volumeStats: { name: string; words: number; chapters: number }[] = [];

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
      const volTitle = vIdx < outline.volumes.length ? outline.volumes[vIdx].title : '未知';
      volumeStats.push({
        name: `第${vIdx + 1}卷：${volTitle}`,
        words: 0,
        chapters: 0,
      });
    }

    volumeWords += content.length;
    volumeChapters++;
  }

  // 保存最后一卷
  if (volumeStats.length > 0) {
    volumeStats[volumeStats.length - 1].words = volumeWords;
    volumeStats[volumeStats.length - 1].chapters = volumeChapters;
  }

  for (const vs of volumeStats) {
    lines.push(`  ${vs.name}：${vs.chapters} 章，${vs.words} 字`);
  }

  return lines.join('\n');
}
