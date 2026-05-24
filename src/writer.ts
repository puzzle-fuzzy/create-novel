// 章节写作者

import { ProjectManager, type Progress, type VolumeOutline, type ChapterOutline } from './config';
import { generateWithRetry } from './llm';
import { buildChapterSystemPrompt, buildChapterUserPrompt, extractTail } from './prompts/chapter';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export async function writeAllChapters(pm: ProjectManager): Promise<void> {
  const config = pm.loadConfig();
  const outline = pm.loadOutline();
  let progress = pm.loadProgress();

  if (progress.status === 'completed') {
    console.log('✅ 小说已经全部写完！');
    return;
  }

  // 读取世界设定书
  const worldBiblePath = join(pm.projectDir, 'world_bible.txt');
  if (!existsSync(worldBiblePath)) {
    console.error('❌ 未找到世界设定书，请先运行 plan 命令');
    process.exit(1);
  }
  const worldBible = readFileSync(worldBiblePath, 'utf-8');

  // 修复 6: 预构建 globalIndex → (volumeIndex, chapterIndex) 映射，O(1) 查找
  const globalToLocation = new Map<number, { vIdx: number; cIdx: number }>();
  for (const vol of outline.volumes) {
    for (const ch of vol.chapters) {
      globalToLocation.set(ch.globalIndex, { vIdx: vol.volumeIndex, cIdx: ch.chapterIndex });
    }
  }

  // 更新进度
  progress.status = 'writing';
  progress.totalChapters = outline.totalChapters;
  pm.saveProgress(progress);

  // 加载之前的章节摘要（用于上下文）
  const chapterSummaries: Map<number, string> = new Map();

  console.log('\n✍️ 开始逐章写作...\n');
  console.log(`  总计：${outline.totalVolumes} 卷，${outline.totalChapters} 章`);
  console.log(`  已完成：${progress.completedChapters} 章`);
  console.log('');

  for (const volume of outline.volumes) {
    for (const chapter of volume.chapters) {
      // 跳过已完成的章节
      const existingContent = pm.loadChapter(volume.volumeIndex, chapter.chapterIndex);
      if (existingContent) {
        console.log(`  ⏭️  第${chapter.globalIndex + 1}章「${chapter.title}」- 已存在，跳过`);
        const summary = existingContent.length > 500
          ? existingContent.slice(0, 300) + '...' + existingContent.slice(-200)
          : existingContent;
        chapterSummaries.set(chapter.globalIndex, summary);
        continue;
      }

      console.log(`\n📝 正在写作：第${chapter.globalIndex + 1}章「${chapter.title}」`);

      // 获取前一章摘要和尾部（O(1) 查找）
      const prevSummary = chapterSummaries.get(chapter.globalIndex - 1);
      let prevTail: string | undefined;
      if (chapter.globalIndex > 0) {
        const prevLoc = globalToLocation.get(chapter.globalIndex - 1);
        if (prevLoc) {
          const prevContent = pm.loadChapter(prevLoc.vIdx, prevLoc.cIdx);
          if (prevContent) prevTail = extractTail(prevContent);
        }
      }

      try {
        const systemPrompt = buildChapterSystemPrompt(config);
        const userPrompt = buildChapterUserPrompt(
          config, worldBible, volume, chapter,
          prevSummary, prevTail
        );

        const result = await generateWithRetry({
          systemPrompt,
          userPrompt,
          model: process.env.LLM_WRITER_MODEL || undefined,
          temperature: 0.85,
          maxTokens: 16384,
        });

        const content = cleanChapterContent(result.content);

        // 保存章节
        pm.saveChapter(volume.volumeIndex, chapter.chapterIndex, content);

        // 生成摘要（简化版，不消耗 API）
        const summary = content.length > 500
          ? content.slice(0, 300) + '...' + content.slice(-200)
          : content;
        chapterSummaries.set(chapter.globalIndex, summary);

        // 更新进度
        progress.completedChapters++;
        progress.totalWords += content.length;
        progress.lastWrittenChapter = chapter.globalIndex;
        progress.totalTokensUsed += result.usage.totalTokens;
        progress.currentPhase = `第${volume.volumeIndex + 1}卷 - 第${chapter.chapterIndex + 1}章「${chapter.title}」`;
        pm.saveProgress(progress);

        console.log(`  ✅ 完成（${content.length} 字，Token: ${result.usage.totalTokens}）`);
        console.log(`  📊 总进度：${progress.completedChapters}/${progress.totalChapters} 章，${(progress.totalWords / 10000).toFixed(1)} 万字`);

        // 每写完一章暂停一下，避免 API 限流
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error: any) {
        console.error(`  ❌ 写作失败：${error.message}`);
        progress.errors.push(`第${chapter.globalIndex + 1}章「${chapter.title}」: ${error.message}`);
        progress.status = 'paused';
        pm.saveProgress(progress);
        console.log('  ⏸️  已暂停。重新运行 write 命令将从断点继续。');
        return;
      }
    }
  }

  progress.status = 'completed';
  progress.currentPhase = '全部完成';
  pm.saveProgress(progress);
  console.log('\n🎉 小说全部写作完成！');
  console.log(`  📊 最终统计：${progress.totalWords} 字，${progress.completedChapters} 章`);
  console.log(`  💰 Token 消耗：${progress.totalTokensUsed}`);
}

/**
 * 修复 7: 安全的内容清理
 * 只移除 LLM 可能添加的包裹标记，不误删正文
 */
function cleanChapterContent(content: string): string {
  let cleaned = content.trim();

  // 只在整段被 ``` 包裹时才移除（LLM 有时用 markdown code block 包裹输出）
  if (cleaned.startsWith('```') && cleaned.endsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // 移除 LLM 可能添加的 "以下是..." 前缀
  cleaned = cleaned.replace(/^(以下是|以下是为|好的，[这那]|好的，以下)/, '').trim();

  // 移除结尾的元信息注释
  cleaned = cleaned.replace(/\n?\(本章完[。.]?\)\s*$/, '');
  cleaned = cleaned.replace(/\n?\[字数[：:].*?\]\s*$/, '');

  return cleaned.trim();
}
