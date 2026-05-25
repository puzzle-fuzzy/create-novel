// 大纲生成器（支持多篇 Arc 结构）

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ProjectManager, type NovelConfig, type FullOutline, type VolumeOutline, type ArcDefinition } from './config';
import { extractJSON } from './utils';
import { generateWithRetry } from './llm';
import { emitStatusEvent } from './events';
import { buildWorldBiblePrompt, buildVolumeOutlinePrompt, buildPremiseOutlinePrompt, buildArcOutlinePrompt } from './prompts/world';
import { loadArcSummaries } from './memory/arc_summary';
import { loadVolumeSummaries } from './memory/volume_summary';

export async function generateWorldBible(pm: ProjectManager): Promise<string> {
  const config = pm.loadConfig();

  const existingBible = join(pm.projectDir, 'world_bible.txt');
  if (existsSync(existingBible)) {
    const content = readFileSync(existingBible, 'utf-8');
    if (content.length > 500) {
      console.log(`  ⏭️  世界设定书已存在（${content.length} 字），跳过生成`);
      return content;
    }
  }

  emitStatusEvent('phase_change', { phase: 'generating_world_bible' });
  console.log('\n🌍 正在生成世界设定书...');
  console.log('  这可能需要几分钟时间...\n');

  const result = await generateWithRetry({
    systemPrompt: '你是一位经验丰富的小说世界观架构师，善于创造深邃、复杂、充满冲突的虚构世界。你的设定需要足够丰富，能支撑超长篇叙事。',
    userPrompt: buildWorldBiblePrompt(config),
    model: process.env.LLM_PLANNER_MODEL || undefined,
    temperature: 0.8,
    maxTokens: 16384,
  });

  const worldBible = result.content;
  writeFileSync(join(pm.projectDir, 'world_bible.txt'), worldBible, 'utf-8');

  console.log(`  ✅ 世界设定书生成完成（${worldBible.length} 字）`);
  console.log(`  📊 Token 消耗：${result.usage.totalTokens}`);
  return worldBible;
}

/**
 * 生成篇（Arc）定义
 */
async function generateArcOutlines(pm: ProjectManager, config: NovelConfig): Promise<ArcDefinition[]> {
  // 如果已有篇定义，直接返回
  if (config.plotFramework.arcs && config.plotFramework.arcs.length > 0) {
    console.log(`  ⏭️  已有 ${config.plotFramework.arcs.length} 个篇定义，跳过`);
    return config.plotFramework.arcs;
  }

  emitStatusEvent('phase_change', { phase: 'planning_arcs' });
  console.log('\n📖 正在规划多篇结构...');
  const result = await generateWithRetry({
    systemPrompt: '你是一位专业的超长篇小说策划师，擅长规划多篇章结构。请严格按照 JSON 格式输出。',
    userPrompt: buildArcOutlinePrompt(config),
    model: process.env.LLM_PLANNER_MODEL || undefined,
    temperature: 0.75,
    maxTokens: 8192,
  });

  try {
    const jsonStr = extractJSON(result.content);
    const data = JSON.parse(jsonStr);
    const arcs: ArcDefinition[] = (data.arcs || []).map((arc: any, i: number) => ({
      arcIndex: i,
      title: arc.title || `篇${i + 1}`,
      volumeRange: arc.volumeRange || { start: 0, end: 0 },
      summary: arc.summary || '',
      subConflict: arc.subConflict || '',
      keyCharacters: arc.keyCharacters || [],
      climax: arc.climax || '',
      resolution: arc.resolution || '',
      connectsTo: arc.connectsTo || '',
    }));

    // 验证 arc 覆盖范围完整性
    const coveredVolumes = new Set<number>();
    for (const arc of arcs) {
      for (let v = arc.volumeRange.start; v <= arc.volumeRange.end; v++) {
        coveredVolumes.add(v);
      }
    }
    const missingVolumes: number[] = [];
    for (let v = 0; v < config.generation.volumeCount; v++) {
      if (!coveredVolumes.has(v)) missingVolumes.push(v);
    }
    if (missingVolumes.length > 0) {
      console.warn(`  ⚠️ 篇结构未覆盖卷 ${missingVolumes.map(v => v + 1).join(',')}，将自动补全`);
      // 将未覆盖的卷附加到最后一个篇或创建新篇
      const lastArc = arcs[arcs.length - 1];
      for (const v of missingVolumes) {
        if (lastArc && v === lastArc.volumeRange.end + 1) {
          lastArc.volumeRange.end = v;
        } else {
          arcs.push({
            arcIndex: arcs.length,
            title: `补余篇${arcs.length + 1}`,
            volumeRange: { start: v, end: v },
            summary: `覆盖第${v + 1}卷`,
            subConflict: config.plotFramework.mainConflict,
            keyCharacters: [],
            climax: '',
            resolution: '',
            connectsTo: '',
          });
        }
      }
      // 重新编号
      arcs.forEach((a, i) => a.arcIndex = i);
      console.log(`  ✅ 补全后共 ${arcs.length} 个篇`);
    }

    // 保存到 config
    config.plotFramework.arcs = arcs;
    pm.saveConfig(config);

    console.log(`  ✅ 规划了 ${arcs.length} 个篇：`);
    for (const arc of arcs) {
      console.log(`     篇${arc.arcIndex + 1}「${arc.title}」：卷 ${arc.volumeRange.start + 1}-${arc.volumeRange.end + 1}`);
    }
    return arcs;
  } catch (e: any) {
    console.warn(`  ⚠️ 篇结构生成失败：${e.message}，将使用单篇模式`);
    const defaultArc: ArcDefinition = {
      arcIndex: 0,
      title: '全篇',
      volumeRange: { start: 0, end: config.generation.volumeCount - 1 },
      summary: config.plotFramework.mainConflict,
      subConflict: config.plotFramework.mainConflict,
      keyCharacters: [],
      climax: config.plotFramework.climax,
      resolution: config.plotFramework.resolution,
      connectsTo: '全书完结',
    };
    config.plotFramework.arcs = [defaultArc];
    pm.saveConfig(config);
    return [defaultArc];
  }
}

/**
 * 找到当前卷所属的篇
 */
function findArcForVolume(arcs: ArcDefinition[], volumeIndex: number): ArcDefinition | undefined {
  return arcs.find(arc => volumeIndex >= arc.volumeRange.start && volumeIndex <= arc.volumeRange.end);
}

export async function generateFullOutline(pm: ProjectManager): Promise<FullOutline> {
  const config = pm.loadConfig();

  // Step 1: 生成/加载世界设定书
  const worldBible = await generateWorldBible(pm);

  // Step 2: 生成/加载篇定义
  const arcs = await generateArcOutlines(pm, config);

  // Step 3: 加载已有大纲（支持断点续生成）
  let volumes: VolumeOutline[] = [];
  let totalChapters = 0;
  let premise = '';

  if (existsSync(pm.outlinePath)) {
    try {
      const existing = JSON.parse(readFileSync(pm.outlinePath, 'utf-8'));
      volumes = existing.volumes || [];
      totalChapters = volumes.reduce((sum: number, v: VolumeOutline) => sum + v.chapters.length, 0);
      premise = existing.premise || '';
      console.log(`  ⏭️  已有 ${volumes.length} 卷大纲，从第 ${volumes.length + 1} 卷继续`);
    } catch {
      console.log('  ⚠️ 已有大纲文件损坏，重新生成');
    }
  }

  // Step 4: 生成总体概要（仅在首次）
  if (!premise) {
    emitStatusEvent('phase_change', { phase: 'generating_premise' });
    console.log('\n📖 正在生成故事总体概要...');
    const premiseResult = await generateWithRetry({
      systemPrompt: '你是一位顶级小说策划师，擅长构建引人入胜的超长篇故事。',
      userPrompt: buildPremiseOutlinePrompt(config),
      model: process.env.LLM_PLANNER_MODEL || undefined,
      temperature: 0.8,
      maxTokens: 4096,
    });
    premise = premiseResult.content;
    console.log(`  ✅ 概要生成完成`);
    console.log(`  📊 Token 消耗：${premiseResult.usage.totalTokens}`);
  }

  // Step 5: 逐卷生成大纲（带篇上下文）
  const startVolume = volumes.length;
  const arcSummaries = loadArcSummaries(pm);
  const volumeSummaries = loadVolumeSummaries(pm);
  let previousSummary: string | undefined = volumes.length > 0
    ? volumes[volumes.length - 1].summary
    : undefined;

  for (let v = startVolume; v < config.generation.volumeCount; v++) {
    const currentArc = findArcForVolume(arcs, v);
    emitStatusEvent('planning_progress', { phase: 'generating_volume_outline', volumeIndex: v, totalVolumes: config.generation.volumeCount });
    console.log(`\n📚 正在生成第 ${v + 1}/${config.generation.volumeCount} 卷大纲${currentArc ? `（篇${currentArc.arcIndex + 1}「${currentArc.title}」）` : ''}...`);

    // 构建篇上下文
    let arcContext: Parameters<typeof buildVolumeOutlinePrompt>[5];
    if (currentArc) {
      const completedVolSummaries: string[] = [];
      for (let pv = currentArc.volumeRange.start; pv < v; pv++) {
        const vs = volumeSummaries[pv];
        if (vs) completedVolSummaries.push(`第${pv + 1}卷「${(vs as any).title}」：${(vs as any).summary}`);
      }
      arcContext = {
        arc: currentArc,
        arcSummary: currentArc.arcIndex > 0 ? arcSummaries[currentArc.arcIndex - 1]?.summary : undefined,
        completedVolumeSummaries: completedVolSummaries.length > 0 ? completedVolSummaries : undefined,
      };
    }

    let volumeResult = await generateWithRetry({
      systemPrompt: '你是一位专业的小说大纲策划师。请严格按照 JSON 格式输出。注意控制篇幅，确保 JSON 完整闭合，不要被截断。',
      userPrompt: buildVolumeOutlinePrompt(config, worldBible, v, config.generation.volumeCount, previousSummary, arcContext),
      model: process.env.LLM_PLANNER_MODEL || undefined,
      temperature: 0.75,
      maxTokens: 16384,
    });

    let volumeData: any;
    let parseSuccess = false;
    let lastParseError: Error | null = null;

    for (let parseAttempt = 0; parseAttempt < 3; parseAttempt++) {
      try {
        const jsonStr = extractJSON(volumeResult.content);
        volumeData = JSON.parse(jsonStr);
        parseSuccess = true;
        break;
      } catch (parseErr) {
        lastParseError = parseErr as Error;
        if (parseAttempt < 2) {
          console.log(`  ⚠️ 第 ${v + 1} 卷 JSON 解析失败（第${parseAttempt + 1}次），尝试重新生成...`);
          // 第二次重试用更精简的提示，强制缩短输出
          const isRetry = parseAttempt === 1;
          volumeResult = await generateWithRetry({
            systemPrompt: isRetry
              ? '输出精简版大纲。每章 summary 不超过50字，keyScenes 只写1条。确保 JSON 完整闭合。'
              : '你是一位专业的小说大纲策划师。请严格按照 JSON 格式输出。注意控制篇幅，确保 JSON 完整闭合。',
            userPrompt: buildVolumeOutlinePrompt(config, worldBible, v, config.generation.volumeCount, previousSummary, arcContext),
            model: process.env.LLM_PLANNER_MODEL || undefined,
            temperature: 0.75,
            maxTokens: 16384,
          });
        }
      }
    }

    if (!parseSuccess) {
      console.error(`  ❌ 第 ${v + 1} 卷大纲解析失败：${lastParseError}`);
      console.log(`  原始输出：${volumeResult.content.slice(0, 500)}...`);
      if (volumes.length > 0) {
        const partialOutline: FullOutline = {
          novelTitle: config.worldSetting.name,
          premise,
          totalVolumes: config.generation.volumeCount,
          totalChapters,
          estimatedWords: totalChapters * config.generation.wordsPerChapter,
          volumes,
        };
        pm.saveOutline(partialOutline);
        console.log(`  💾 已保存前 ${volumes.length} 卷大纲，重新运行 plan 可继续`);
      }
      throw lastParseError;
    }

    const volume: VolumeOutline = {
      volumeIndex: v,
      arcIndex: currentArc?.arcIndex,
      title: volumeData.title,
      summary: volumeData.summary,
      keyEvents: volumeData.keyEvents || [],
      characterDevelopments: volumeData.characterDevelopments || [],
      chapters: (volumeData.chapters || []).map((ch: any, i: number) => ({
        chapterIndex: i,
        globalIndex: totalChapters + i,
        title: ch.title,
        summary: ch.summary,
        keyScenes: ch.keyScenes || [],
        characters: ch.characters || [],
        mood: ch.mood || '正常',
        cliffhanger: ch.cliffhanger,
        targetWords: ch.targetWords || config.generation.wordsPerChapter,
      })),
    };

    totalChapters += volume.chapters.length;
    volumes.push(volume);
    previousSummary = volume.summary;

    // 每卷保存一次
    const partialOutline: FullOutline = {
      novelTitle: config.worldSetting.name,
      premise,
      totalVolumes: config.generation.volumeCount,
      totalChapters,
      estimatedWords: totalChapters * config.generation.wordsPerChapter,
      volumes,
    };
    pm.saveOutline(partialOutline);

    console.log(`  ✅ 第 ${v + 1} 卷「${volume.title}」- ${volume.chapters.length} 章`);
    console.log(`  📊 Token 消耗：${volumeResult.usage.totalTokens}`);
  }

  if (volumes.length < config.generation.volumeCount) {
    console.warn(`\n  ⚠️ 警告：配置要求 ${config.generation.volumeCount} 卷，但只成功生成了 ${volumes.length} 卷`);
    console.warn(`     已保存 ${volumes.length} 卷大纲，可以重新运行 plan 继续补全`);
  }

  const outline: FullOutline = {
    novelTitle: config.worldSetting.name,
    premise,
    totalVolumes: volumes.length,
    totalChapters,
    estimatedWords: totalChapters * config.generation.wordsPerChapter,
    volumes,
  };

  pm.saveOutline(outline);
  console.log(`\n✅ 完整大纲生成完成！`);
  console.log(`  📊 共 ${outline.totalVolumes} 卷，${outline.totalChapters} 章，预计 ${outline.estimatedWords} 字`);

  return outline;
}
