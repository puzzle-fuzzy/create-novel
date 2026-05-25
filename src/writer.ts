// 章节写作者 — Agent 驱动 + 闭环质量控制 + 层级记忆 + 边界处理

import { ProjectManager, type Progress, type ChapterOutline, type ArcDefinition } from './config';
import { emitStatusEvent } from './events';
import { generateWithRetry } from './llm';
import { buildChapterSystemPrompt, buildChapterUserPrompt, extractTail } from './prompts/chapter';
import { buildStateExtractionPrompt } from './prompts/state';
import { buildReviewPrompt, parseReviewResult, type ReviewResult } from './prompts/review';
import { buildSummaryExtractionPrompt, loadSummaries, saveSummary, type ChapterSummary } from './memory/summaries';
import { loadState, saveState, applyStateUpdate, buildStateContext, type WorldState, type StateUpdate } from './memory/state';
import { checkQuality, classifyOpening, type QualityReport } from './quality/checker';
import { assembleChapterContext } from './memory/context_assembler';
import { makeChapterDecision, evaluateStoryHealth } from './agent/controller';
import { generateVolumeSummary } from './memory/volume_summary';
import { generateArcSummary } from './memory/arc_summary';
import { snapshotStateAtVolumeEnd, pruneRuntimeState } from './memory/volume_state';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const MAX_WRITE_ATTEMPTS = 5;
const REVIEW_PASS_THRESHOLD = 7.0;

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

  // 构建 globalIndex → (volumeIndex, chapterIndex) 映射
  const globalToLocation = new Map<number, { vIdx: number; cIdx: number }>();
  for (const vol of outline.volumes) {
    for (const ch of vol.chapters) {
      globalToLocation.set(ch.globalIndex, { vIdx: vol.volumeIndex, cIdx: ch.chapterIndex });
    }
  }

  // 获取篇定义
  const arcs = config.plotFramework.arcs || [];
  const totalChapters = outline.totalChapters;

  // 加载全局状态和摘要
  let state = loadState(pm);
  const summaries = loadSummaries(pm);

  // 更新进度
  progress.status = 'writing';
  progress.totalChapters = outline.totalChapters;
  pm.saveProgress(progress);

  console.log('\n✍️ 开始逐章写作（Agent 驱动 + 高质量闭环模式）...\n');
  console.log(`  总计：${outline.totalVolumes} 卷，${outline.totalChapters} 章`);
  console.log(`  篇结构：${arcs.length > 1 ? `${arcs.length} 篇` : '单篇'}`);
  console.log(`  已完成：${progress.completedChapters} 章`);
  console.log(`  质量标准：代码检查≥70分 + LLM审查≥${REVIEW_PASS_THRESHOLD}/10`);
  console.log(`  每章最多重试：${MAX_WRITE_ATTEMPTS} 次`);
  console.log(`  Agent 模型：${process.env.LLM_AGENT_MODEL || '未设置（使用默认策略）'}`);
  console.log('');

  emitStatusEvent('phase_change', { phase: 'writing', totalVolumes: outline.totalVolumes, totalChapters: outline.totalChapters, completedChapters: progress.completedChapters });

  for (const volume of outline.volumes) {
    const currentArc = findArcForVolume(arcs, volume.volumeIndex);

    for (const chapter of volume.chapters) {
      // 跳过已完成的章节
      const existingContent = pm.loadChapter(volume.volumeIndex, chapter.chapterIndex);
      if (existingContent) {
        console.log(`  ⏭️  第${chapter.globalIndex + 1}章「${chapter.title}」- 已存在，跳过`);

        if (!summaries[chapter.globalIndex]) {
          const fallbackSummary = existingContent.length > 500
            ? existingContent.slice(0, 300) + '...' + existingContent.slice(-200)
            : existingContent;
          summaries[chapter.globalIndex] = {
            chapterIndex: chapter.globalIndex,
            title: chapter.title,
            plotProgress: '',
            characterChanges: [],
            newInformation: [],
            endingHook: '',
            narrativeSummary: fallbackSummary,
          };
        }
        continue;
      }

      console.log(`\n${'═'.repeat(50)}`);
      console.log(`📝 正在写作：第${chapter.globalIndex + 1}章「${chapter.title}」`);
      if (currentArc) {
        console.log(`📖 当前篇：${currentArc.title}（卷${volume.volumeIndex + 1}/${outline.totalVolumes}）`);
      }
      console.log(`${'═'.repeat(50)}`);

      // ── Agent 写前决策 ──
      console.log(`  🤖 Agent 制定写作策略...`);
      const agentDecision = await makeChapterDecision(
        pm, state, chapter.globalIndex, totalChapters,
        currentArc, volume, chapter,
      );
      emitStatusEvent('agent_decision', { globalIndex: chapter.globalIndex, pacing: agentDecision.pacing, plotFocus: agentDecision.plotFocus, featuredCharacters: agentDecision.featuredCharacters });
      console.log(`  📋 策略：${agentDecision.pacing}节奏，焦点=${agentDecision.plotFocus}，重点角色=${agentDecision.featuredCharacters.join('、') || '按大纲'}`);

      // ── 层级上下文组装 ──
      const stateContext = buildStateContext(state, chapter.globalIndex);
      const context = assembleChapterContext(
        pm, chapter.globalIndex, currentArc, state, stateContext, agentDecision,
      );

      const prevSummary = summaries[chapter.globalIndex - 1]?.narrativeSummary;
      let prevTail: string | undefined;
      if (chapter.globalIndex > 0) {
        const prevLoc = globalToLocation.get(chapter.globalIndex - 1);
        if (prevLoc) {
          const prevContent = pm.loadChapter(prevLoc.vIdx, prevLoc.cIdx);
          if (prevContent) prevTail = extractTail(prevContent);
        }
      }

      // ── 核心：生成 → 检查 → 审查 → 循环 ──
      let finalContent = '';
      let bestContent = '';
      let bestScore = -1;
      let qualityReport: QualityReport | undefined;
      let reviewResult: ReviewResult | undefined;
      let chapterTokens = 0;

      for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
        const qualityFeedback = qualityReport?.issues.map(i => i.message);
        const reviewAdvice = reviewResult
          ? `编辑评分：${reviewResult.overallScore}/10\n问题：${reviewResult.issues.join('；')}\n改进建议：${reviewResult.rewriteAdvice}`
          : undefined;

        const systemPrompt = buildChapterSystemPrompt(config);
        const userPrompt = buildChapterUserPrompt(
          config, worldBible, volume, chapter,
          prevSummary, prevTail,
          context.stateContextText, context.recentSummariesText,
          qualityFeedback, reviewAdvice,
          currentArc?.title, context.arcSummariesText,
          context.volumeSummariesText, context.agentStrategyText,
        );

        try {
          const useStream = process.env.LLM_STREAM === 'true';
          const result = await generateWithRetry({
            systemPrompt,
            userPrompt,
            model: process.env.LLM_WRITER_MODEL || undefined,
            temperature: 0.85 + attempt * 0.03,
            maxTokens: 16384,
            stream: useStream,
            onChunk: useStream ? (text) => process.stdout.write(text) : undefined,
          });
          chapterTokens += result.usage.totalTokens;

          const content = cleanChapterContent(result.content);

          // Step 1: 代码级质量检查
          qualityReport = checkQuality(content, chapter.globalIndex, state, chapter);

          if (!qualityReport.passed) {
            console.log(`  ⚠️ 代码检查未通过（分数：${qualityReport.score}/100，第${attempt + 1}次）`);
            for (const issue of qualityReport.issues) {
              console.log(`     ${issue.severity === 'error' ? '❌' : '⚠️'} ${issue.message}`);
            }
            if (qualityReport.score > bestScore) {
              bestScore = qualityReport.score;
              bestContent = content;
            }
            if (attempt < MAX_WRITE_ATTEMPTS - 1) {
              console.log(`     → 重写中...`);
              continue;
            } else {
              console.log(`     → 已达重试上限，进入 LLM 审查`);
              finalContent = content;
              break;
            }
          }

          // Step 2: LLM 深度审查
          emitStatusEvent('quality_check', { globalIndex: chapter.globalIndex, score: qualityReport.score, passed: true });
          console.log(`  ✅ 代码检查通过（${qualityReport.score}/100）→ 启动 LLM 审查...`);

          try {
            const stateSummaryForReview = buildStateSummaryForReview(state, chapter);
            const reviewPrompt = buildReviewPrompt(content, chapter, stateSummaryForReview);
            const reviewRaw = await generateWithRetry({
              systemPrompt: '你是一位极其严格的小说编辑，你的审查标准是出版级质量。请按 JSON 格式输出审查结果。',
              userPrompt: reviewPrompt,
              model: process.env.LLM_PLANNER_MODEL || process.env.LLM_WRITER_MODEL || undefined,
              temperature: 0.3,
              maxTokens: 2048,
            });
            chapterTokens += reviewRaw.usage.totalTokens;

            reviewResult = parseReviewResult(reviewRaw.content);
            console.log(`  📝 LLM 审查评分：${reviewResult.overallScore}/10`);
            console.log(`     情节完成度：${reviewResult.scores.plotCompletion} | 角色一致性：${reviewResult.scores.characterConsistency} | 连贯性：${reviewResult.scores.contextCoherence}`);
            console.log(`     文笔质量：${reviewResult.scores.writingQuality} | 吸引力：${reviewResult.scores.attractiveness}`);

            if (reviewResult.issues.length > 0) {
              console.log(`  📋 问题：`);
              for (const issue of reviewResult.issues) {
                console.log(`     - ${issue}`);
              }
            }

            if (reviewResult.overallScore > bestScore / 10) {
              bestScore = Math.round(reviewResult.overallScore * 10);
              bestContent = content;
            }

            if (reviewResult.overallScore >= REVIEW_PASS_THRESHOLD) {
              console.log(`  🎉 审查通过！（${reviewResult.overallScore}/10 ≥ ${REVIEW_PASS_THRESHOLD}）`);
              finalContent = content;
              break;
            } else {
              console.log(`  ⚠️ 审查未通过（${reviewResult.overallScore}/10 < ${REVIEW_PASS_THRESHOLD}），根据编辑意见重写...`);
              if (attempt < MAX_WRITE_ATTEMPTS - 1) {
                continue;
              } else {
                console.log(`  ⚠️ 已达重试上限，使用最佳版本（评分 ${bestScore}）`);
                finalContent = bestContent || content;
              }
            }
          } catch (reviewErr: any) {
            console.log(`  ⚠️ LLM 审查失败（${reviewErr.message}），代码检查已通过，直接采用`);
            finalContent = content;
            break;
          }

        } catch (error: any) {
          console.error(`  ❌ 写作失败：${error.message}`);
          if (attempt === MAX_WRITE_ATTEMPTS - 1) {
            if (bestContent) {
              console.log(`  ⚠️ 使用已有的最佳版本`);
              finalContent = bestContent;
            } else {
              emitStatusEvent('error', { globalIndex: chapter.globalIndex, title: chapter.title, error: error.message });
              progress.errors.push(`第${chapter.globalIndex + 1}章「${chapter.title}」: ${error.message}`);
              progress.status = 'paused';
              pm.saveProgress(progress);
              console.log('  ⏸️  已暂停。重新运行 write 命令将从断点继续。');
              return;
            }
          }
        }
      }

      if (!finalContent) {
        console.error(`  ❌ 第${chapter.globalIndex + 1}章生成失败，跳过`);
        continue;
      }

      // ── 保存章节 ──
      pm.saveChapter(volume.volumeIndex, chapter.chapterIndex, finalContent);

      // ── 更新全局状态 ──
      try {
        console.log(`  🧠 更新全局状态...`);
        const stateExtractionPrompt = buildStateExtractionPrompt(chapter.title, finalContent);
        const stateResult = await generateWithRetry({
          systemPrompt: '你是一个精确的信息提取助手。请从小说章节中提取结构化信息，严格按 JSON 格式输出。',
          userPrompt: stateExtractionPrompt,
          model: process.env.LLM_WRITER_MODEL || undefined,
          temperature: 0.3,
          maxTokens: 4096,
        });
        chapterTokens += stateResult.usage.totalTokens;

        const stateUpdate = extractStateUpdateFromLLM(stateResult.content);
        applyStateUpdate(state, stateUpdate, chapter.globalIndex);
        saveState(pm, state);

        ensureOpeningRecord(state, finalContent, chapter.globalIndex);
        saveState(pm, state);

        const unresolvedForeshadows = state.foreshadows.filter(f => !f.resolved).length;
        console.log(`  📊 状态：${Object.keys(state.characters).length} 个角色，${unresolvedForeshadows} 个活跃伏笔`);
      } catch (e: any) {
        console.log(`  ⚠️ 状态更新失败：${e.message}`);
        ensureOpeningRecord(state, finalContent, chapter.globalIndex);
        saveState(pm, state);
      }

      // ── 生成结构化摘要 ──
      try {
        const summaryPrompt = buildSummaryExtractionPrompt(chapter.title, finalContent);
        const summaryResult = await generateWithRetry({
          systemPrompt: '你是一个精确的小说摘要生成助手。请从章节内容中提取结构化摘要，严格按 JSON 格式输出。',
          userPrompt: summaryPrompt,
          model: process.env.LLM_WRITER_MODEL || undefined,
          temperature: 0.3,
          maxTokens: 2048,
        });
        chapterTokens += summaryResult.usage.totalTokens;

        const summaryData = extractSummaryFromLLM(summaryResult.content, chapter.globalIndex, chapter.title);
        saveSummary(pm, chapter.globalIndex, summaryData);
        summaries[chapter.globalIndex] = summaryData;
      } catch (e: any) {
        console.log(`  ⚠️ 摘要生成失败：${e.message}`);
        const fallback: ChapterSummary = {
          chapterIndex: chapter.globalIndex,
          title: chapter.title,
          plotProgress: '',
          characterChanges: [],
          newInformation: [],
          endingHook: '',
          narrativeSummary: finalContent.length > 500
            ? finalContent.slice(0, 300) + '...' + finalContent.slice(-200)
            : finalContent,
        };
        saveSummary(pm, chapter.globalIndex, fallback);
        summaries[chapter.globalIndex] = fallback;
      }

      // ── Agent 写后评估 ──
      try {
        const health = await evaluateStoryHealth(pm, state, chapter.globalIndex, totalChapters);
        if (health) {
          console.log(`  🏥 故事健康检查：`);
          if (health.pacingAssessment !== 'good') {
            console.log(`     ⚠️ 节奏评估：${health.pacingAssessment}`);
          }
          if (health.recommendations.length > 0) {
            for (const r of health.recommendations.slice(0, 3)) {
              console.log(`     💡 ${r}`);
            }
          }
        }
      } catch {
        // 静默跳过健康检查失败
      }

      emitStatusEvent('chapter_complete', { globalIndex: chapter.globalIndex, title: chapter.title, charCount: finalContent.replace(/[^\u4e00-\u9fff]/g, '').length, tokens: chapterTokens });
      // ── 更新进度 ──
      const charCount = finalContent.replace(/[^一-鿿]/g, '').length;
      progress.completedChapters++;
      progress.totalWords += charCount;
      progress.totalTokensUsed += chapterTokens;
      progress.lastWrittenChapter = chapter.globalIndex;
      progress.currentVolumeIndex = volume.volumeIndex;
      progress.currentArcIndex = currentArc?.arcIndex;
      progress.volumeWordCounts = progress.volumeWordCounts || {};
      progress.volumeWordCounts[volume.volumeIndex] = (progress.volumeWordCounts[volume.volumeIndex] || 0) + charCount;
      progress.currentPhase = `第${volume.volumeIndex + 1}卷 - 第${chapter.chapterIndex + 1}章「${chapter.title}」`;
      pm.saveProgress(progress);

      console.log(`  ✅ 完成（${charCount} 汉字，${chapterTokens} tokens）`);
      console.log(`  📊 进度：${progress.completedChapters}/${progress.totalChapters} 章，${(progress.totalWords / 10000).toFixed(1)} 万字，累计 ${progress.totalTokensUsed} tokens`);

      // ── 卷边界处理 ──
      const isLastChapterInVolume = chapter.chapterIndex === volume.chapters.length - 1;
      if (isLastChapterInVolume) {
        emitStatusEvent('volume_complete', { volumeIndex: volume.volumeIndex, title: volume.title });
        console.log(`\n  📦 卷${volume.volumeIndex + 1}「${volume.title}」完成！`);
        progress.completedVolumes = (progress.completedVolumes || 0) + 1;

        try {
          console.log(`  📝 生成卷摘要...`);
          const volSummary = await generateVolumeSummary(pm, volume.volumeIndex, currentArc?.arcIndex || 0);
          console.log(`  ✅ 卷摘要生成完成（${volSummary.summary.length}字）`);
        } catch (e: any) {
          console.log(`  ⚠️ 卷摘要生成失败：${e.message}`);
        }

        // 状态快照 + 修剪
        snapshotStateAtVolumeEnd(pm, state, volume.volumeIndex);
        pruneRuntimeState(state, chapter.globalIndex, config.generation.chaptersPerVolume);
        saveState(pm, state);

        // ── 篇边界处理 ──
        const isLastVolumeInArc = currentArc && volume.volumeIndex === currentArc.volumeRange.end;
        if (isLastVolumeInArc) {
          emitStatusEvent('arc_complete', { arcIndex: currentArc.arcIndex, title: currentArc.title });
          console.log(`\n  🎭 篇${currentArc.arcIndex + 1}「${currentArc.title}」完成！`);
          progress.completedArcs = (progress.completedArcs || 0) + 1;

          try {
            console.log(`  📝 生成篇摘要...`);
            const arcSummary = await generateArcSummary(pm, currentArc);
            console.log(`  ✅ 篇摘要生成完成（${arcSummary.summary.length}字）`);
          } catch (e: any) {
            console.log(`  ⚠️ 篇摘要生成失败：${e.message}`);
          }
        }

        pm.saveProgress(progress);
      }

      // 章节间延迟
      const delayMs = parseInt(process.env.CHAPTER_DELAY_MS || '2000');
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  progress.status = 'completed';
  progress.currentPhase = '全部完成';
  pm.saveProgress(progress);
  emitStatusEvent('complete', { totalWords: progress.totalWords, totalChapters: progress.completedChapters });
  console.log('\n🎉 小说全部写作完成！');
  console.log(`  📊 最终统计：${progress.totalWords} 汉字，${progress.completedChapters} 章`);
  console.log(`  📊 追踪 ${Object.keys(state.characters).length} 个角色，${state.foreshadows.length} 个伏笔`);
}

// ── 辅助函数 ──

function findArcForVolume(arcs: ArcDefinition[], volumeIndex: number): ArcDefinition | undefined {
  return arcs.find(arc => volumeIndex >= arc.volumeRange.start && volumeIndex <= arc.volumeRange.end);
}

function buildStateSummaryForReview(state: WorldState, chapter: ChapterOutline): string {
  const parts: string[] = [];

  const relevantChars = chapter.characters
    .map(name => state.characters[name])
    .filter(Boolean);

  if (relevantChars.length > 0) {
    parts.push('本章出场角色当前状态：');
    for (const c of relevantChars) {
      parts.push(`- 位置：${c.currentLocation}，修为：${c.cultivationLevel}，情绪：${c.emotionalState}`);
    }
  }

  const unresolved = state.foreshadows.filter(f => !f.resolved);
  if (unresolved.length > 0) {
    parts.push(`\n未回收伏笔（${unresolved.length}个）：${unresolved.slice(0, 5).map(f => f.description).join('；')}`);
  }

  return parts.join('\n');
}

function ensureOpeningRecord(state: WorldState, content: string, chapterIndex: number): void {
  if (state.recentOpenings.some(o => o.chapterIndex === chapterIndex)) return;
  const firstSentence = content.replace(/^#.*\n?/, '').split(/[。！？\n]/)[0] || '';
  state.recentOpenings.push({
    chapterIndex,
    firstSentence,
    openingType: classifyOpening(firstSentence),
  });
  if (state.recentOpenings.length > 10) {
    state.recentOpenings = state.recentOpenings.slice(-10);
  }
}

function cleanChapterContent(content: string): string {
  let cleaned = content.trim();

  if (cleaned.startsWith('```') && cleaned.endsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```\s*$/, '');
  }

  cleaned = cleaned.replace(/^(以下是|以下是为|好的，[这那]|好的，以下|根据[您以上]|作为)/, '').trim();
  cleaned = cleaned.replace(/\n?\(本章完[。.]?\)\s*$/, '');
  cleaned = cleaned.replace(/\n?\[字数[：:].*?\]\s*$/, '');

  return cleaned.trim();
}

function extractStateUpdateFromLLM(raw: string): StateUpdate {
  try {
    const jsonStr = extractJSON(raw);
    return JSON.parse(jsonStr) as StateUpdate;
  } catch {
    return {};
  }
}

function extractSummaryFromLLM(raw: string, chapterIndex: number, title: string): ChapterSummary {
  try {
    const jsonStr = extractJSON(raw);
    const data = JSON.parse(jsonStr);
    return {
      chapterIndex,
      title,
      plotProgress: data.plotProgress || '',
      characterChanges: data.characterChanges || [],
      newInformation: data.newInformation || [],
      endingHook: data.endingHook || '',
      narrativeSummary: data.narrativeSummary || '',
    };
  } catch {
    return {
      chapterIndex,
      title,
      plotProgress: '',
      characterChanges: [],
      newInformation: [],
      endingHook: '',
      narrativeSummary: raw.slice(0, 300),
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
  raw = raw.replace(/,\s*([\]}])/g, '$1');
  return raw.trim();
}
