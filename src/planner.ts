// 大纲生成器

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ProjectManager, type NovelConfig, type FullOutline, type VolumeOutline } from './config';
import { generateWithRetry } from './llm';
import { buildWorldBiblePrompt, buildVolumeOutlinePrompt, buildPremiseOutlinePrompt } from './prompts/world';

export async function generateWorldBible(pm: ProjectManager): Promise<string> {
  const config = pm.loadConfig();

  // 修复 4: 如果世界设定书已存在，直接复用
  const existingBible = join(pm.projectDir, 'world_bible.txt');
  if (existsSync(existingBible)) {
    const content = readFileSync(existingBible, 'utf-8');
    if (content.length > 500) {
      console.log(`  ⏭️  世界设定书已存在（${content.length} 字），跳过生成`);
      return content;
    }
  }

  console.log('\n🌍 正在生成世界设定书...');
  console.log('  这可能需要几分钟时间...\n');

  const result = await generateWithRetry({
    systemPrompt: '你是一位经验丰富的小说世界观架构师，善于创造深邃、复杂、充满冲突的虚构世界。',
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

export async function generateFullOutline(pm: ProjectManager): Promise<FullOutline> {
  const config = pm.loadConfig();

  // Step 1: 生成/加载世界设定书
  const worldBible = await generateWorldBible(pm);

  // 修复 3: 尝试加载已有大纲，支持增量续生成
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

  // Step 2: 生成总体概要（仅在首次）
  if (!premise) {
    console.log('\n📖 正在生成故事总体概要...');
    const premiseResult = await generateWithRetry({
      systemPrompt: '你是一位顶级小说策划师，擅长构建引人入胜的长篇故事。',
      userPrompt: buildPremiseOutlinePrompt(config),
      model: process.env.LLM_PLANNER_MODEL || undefined,
      temperature: 0.8,
      maxTokens: 4096,
    });
    premise = premiseResult.content;
    console.log(`  ✅ 概要生成完成`);
    console.log(`  📊 Token 消耗：${premiseResult.usage.totalTokens}`);
  }

  // Step 3: 逐卷生成大纲（从已有进度继续）
  const startVolume = volumes.length;
  let previousSummary: string | undefined = volumes.length > 0
    ? volumes[volumes.length - 1].summary
    : undefined;

  for (let v = startVolume; v < config.generation.volumeCount; v++) {
    console.log(`\n📚 正在生成第 ${v + 1}/${config.generation.volumeCount} 卷大纲...`);

    let volumeResult = await generateWithRetry({
      systemPrompt: '你是一位专业的小说大纲策划师。请严格按照 JSON 格式输出。',
      userPrompt: buildVolumeOutlinePrompt(config, worldBible, v, config.generation.volumeCount, previousSummary),
      model: process.env.LLM_PLANNER_MODEL || undefined,
      temperature: 0.75,
      maxTokens: 16384,
    });

    let volumeData: any;
    let parseSuccess = false;
    let lastParseError: Error | null = null;

    for (let parseAttempt = 0; parseAttempt < 2; parseAttempt++) {
      try {
        const jsonStr = extractJSON(volumeResult.content);
        volumeData = JSON.parse(jsonStr);
        parseSuccess = true;
        break;
      } catch (parseErr) {
        lastParseError = parseErr as Error;
        if (parseAttempt === 0) {
          console.log(`  ⚠️ 第 ${v + 1} 卷 JSON 解析失败，尝试重新生成...`);
          // 重新调用 LLM
          volumeResult = await generateWithRetry({
            systemPrompt: '你是一位专业的小说大纲策划师。请严格按照 JSON 格式输出。注意不要输出过长的内容，确保 JSON 完整闭合。',
            userPrompt: buildVolumeOutlinePrompt(config, worldBible, v, config.generation.volumeCount, previousSummary),
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
      // 保存已有的部分大纲
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

      // 修复 3: 每生成一卷就保存，防止崩溃丢失
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

function extractJSON(text: string): string {
  // 尝试提取 ```json ... ``` 代码块
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  let raw = codeBlockMatch ? codeBlockMatch[1].trim() : text;

  // 尝试直接找 JSON 对象
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    raw = raw.slice(start, end + 1);
  }

  // 修复 LLM 常见的 JSON 问题
  return repairJSON(raw);
}

function repairJSON(text: string): string {
  // 1. 移除单行注释 // ...
  text = text.replace(/\/\/.*$/gm, '');
  // 2. 移除多行注释 /* ... */
  text = text.replace(/\/\*[\s\S]*?\*\//g, '');
  // 3. 移除尾部逗号（数组中和对象中）
  text = text.replace(/,\s*([\]}])/g, '$1');
  // 4. 尝试修复未加引号的 key（简单场景）
  text = text.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
  // 5. 修复单引号为双引号
  text = text.replace(/:\s*'([^']*?)'\s*([,}])/g, ': "$1"$2');
  // 6. 移除 BOM 和不可见字符
  text = text.replace(/^[\uFEFF\u200B]+/, '');

  // 7. 修复截断的 JSON：补全缺失的闭合括号
  text = closeBrackets(text);

  return text.trim();
}

function closeBrackets(text: string): string {
  // 去掉可能残留的不完整字符串/值
  // 先移除尾部逗号后可能残留的不完整内容
  text = text.replace(/,\s*$/, '');

  // 移除尾部不完整的字符串值（引号未闭合或值不完整）
  // 例如: "summary": "这是一段没有闭合的字符串
  text = text.replace(/:\s*"([^"\\]*)$/, '": "$1"');
  // 例如: "summary": 一段没有引号的文字
  text = text.replace(/:\s*([^"\s{}\[\]][^"\n]*)$/, '');

  // 再移除一次尾部逗号
  text = text.replace(/,\s*$/, '');

  // 统计未闭合的括号并补全
  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (const ch of text) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? '}' : ']');
    } else if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
      }
    }
  }

  // 逆序补全
  while (stack.length > 0) {
    text += stack.pop();
  }

  return text;
}
