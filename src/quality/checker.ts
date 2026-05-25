// 零成本质量检查 — 纯代码，不调 LLM

import type { WorldState } from '../memory/state';
import type { ChapterOutline } from '../config';

export interface QualityReport {
  passed: boolean;
  score: number; // 0-100
  issues: QualityIssue[];
  shouldRewrite: boolean;
}

export interface QualityIssue {
  type: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export function checkQuality(
  content: string,
  chapterIndex: number,
  state: WorldState,
  outline: ChapterOutline,
): QualityReport {
  const issues: QualityIssue[] = [];
  let score = 100;

  const trimmed = content.trim();

  // ── 1. 字数检查 ──
  const charCount = trimmed.replace(/[^\u4e00-\u9fff]/g, '').length;
  const target = outline.targetWords;

  if (charCount < target * 0.5) {
    issues.push({
      type: 'word_count',
      severity: 'error',
      message: `字数严重不足：${charCount}字，目标${target}字（${Math.round(charCount / target * 100)}%）`,
    });
    score -= 40;
  } else if (charCount < target * 0.7) {
    issues.push({
      type: 'word_count',
      severity: 'error',
      message: `字数偏少：${charCount}字，目标${target}字（${Math.round(charCount / target * 100)}%）`,
    });
    score -= 20;
  } else if (charCount < target * 0.85) {
    issues.push({
      type: 'word_count',
      severity: 'warning',
      message: `字数略少：${charCount}字，目标${target}字（${Math.round(charCount / target * 100)}%）`,
    });
    score -= 8;
  }

  // ── 2. 开头重复检查 ──
  const firstSentence = extractFirstSentence(trimmed);
  const recentOpenings = state.recentOpenings.slice(-5);

  // 完全相同
  for (const opening of recentOpenings) {
    if (firstSentence === opening.firstSentence) {
      issues.push({
        type: 'opening_duplicate',
        severity: 'error',
        message: `开头与第${opening.chapterIndex + 1}章完全相同："${firstSentence.slice(0, 30)}"`,
      });
      score -= 35;
      break;
    }
  }

  // 高度相似（Jaccard > 0.5）
  for (const opening of recentOpenings) {
    const sim = jaccardSimilarity(firstSentence, opening.firstSentence);
    if (sim > 0.5 && firstSentence !== opening.firstSentence) {
      issues.push({
        type: 'opening_similar',
        severity: 'error',
        message: `开头与第${opening.chapterIndex + 1}章高度相似（${Math.round(sim * 100)}%）："${firstSentence.slice(0, 30)}"`,
      });
      score -= 20;
      break;
    }
  }

  // 开头类型连续重复
  const openingType = classifyOpening(firstSentence);
  const recentTypes = recentOpenings.slice(-3).map(o => o.openingType);
  const sameTypeCount = recentTypes.filter(t => t === openingType).length;
  if (sameTypeCount >= 2) {
    issues.push({
      type: 'opening_pattern',
      severity: 'error',
      message: `最近3章已${sameTypeCount}次使用"${openingType}"类开头，必须更换`,
    });
    score -= 25;
  }

  // ── 3. 首字重复检查 ──
  const firstChar = trimmed.replace(/^[#\s\n]+/, '').slice(0, 1);
  const recentFirstChars = recentOpenings.map(o => o.firstSentence.slice(0, 1));
  const sameFirstCharCount = recentFirstChars.filter(c => c === firstChar).length;
  if (sameFirstCharCount >= 2) {
    issues.push({
      type: 'first_char_repeat',
      severity: 'error',
      message: `首字"${firstChar}"在最近章节中已出现${sameFirstCharCount}次，严禁再用`,
    });
    score -= 30;
  }

  // ── 4. 结尾套路检查 ──
  const lastSentence = extractLastSentence(trimmed);
  const cliches = [
    { pattern: /一切.*才.*刚刚.*开始/, label: '一切才刚刚开始' },
    { pattern: /才.*刚刚.*开始/, label: '才刚刚开始' },
    { pattern: /风起.*云涌/, label: '风起云涌' },
    { pattern: /新的.*即将.*开始/, label: '新的即将开始' },
    { pattern: /真正的.*才.*开始/, label: '真正的才开始' },
    { pattern: /注定.*不.*平静/, label: '注定不会平静' },
    { pattern: /这.*才.*是.*开始/, label: '这才是开始' },
    { pattern: /好戏.*才.*开始/, label: '好戏才开始' },
    { pattern: /一切.*才.*开始/, label: '一切才开始' },
    { pattern: /不.*平静/, label: '不会平静' },
    { pattern: /新的.*篇章/, label: '新的篇章' },
    { pattern: /新的.*故事.*即将/, label: '新的故事即将' },
  ];
  for (const { pattern, label } of cliches) {
    if (pattern.test(lastSentence)) {
      issues.push({
        type: 'cliche_ending',
        severity: 'error',
        message: `结尾套路化："${lastSentence}"（模式：${label}）`,
      });
      score -= 15;
      break;
    }
  }

  // ── 5. 内容截断检查 ──
  if (/(?:……|……|\.{3,}|—{2,}|——)$/.test(trimmed)) {
    issues.push({
      type: 'truncated',
      severity: 'warning',
      message: '章节以省略号或破折号结尾，可能被截断或虎头蛇尾',
    });
    score -= 10;
  }

  // ── 6. LLM 元信息残留 ──
  if (/^(好的[，。]|以下是|以下是为|根据您|根据以上|作为)/.test(trimmed)) {
    issues.push({
      type: 'meta_prefix',
      severity: 'error',
      message: '内容开头残留 LLM 元信息，需要清理',
    });
    score -= 10;
  }
  if (/\(本章完[。.]?\)/.test(trimmed) || /\[字数[：:]/.test(trimmed)) {
    issues.push({
      type: 'meta_suffix',
      severity: 'error',
      message: '内容结尾残留 LLM 元信息',
    });
    score -= 10;
  }

  // ── 7. 内容太短 ──
  if (trimmed.length < 500) {
    issues.push({
      type: 'too_short',
      severity: 'error',
      message: `内容过短（${trimmed.length}字符），可能是生成失败`,
    });
    score -= 45;
  }

  // ── 8. 段落结构检查 ──
  const paragraphs = trimmed.split(/\n+/).filter(p => p.trim().length > 0);
  if (paragraphs.length < 5) {
    issues.push({
      type: 'structure',
      severity: 'warning',
      message: `段落过少（${paragraphs.length}段），内容可能缺乏结构`,
    });
    score -= 10;
  }

  // ── 9. 对话存在检查（如果大纲有多个角色出场，应该有对话）──
  if (outline.characters.length >= 2) {
    const dialogueCount = (trimmed.match(/[""「」]/g) || []).length / 2;
    if (dialogueCount < 3) {
      issues.push({
        type: 'lack_dialogue',
        severity: 'warning',
        message: `对话过少（${Math.round(dialogueCount)}处），${outline.characters.length}个角色出场应有更多互动`,
      });
      score -= 8;
    }
  }

  score = Math.max(0, score);

  return {
    passed: score >= 70, // 从 60 提高到 70
    score,
    issues,
    shouldRewrite: score < 55, // 从 50 提高到 55
  };
}

// ── 工具函数 ──

function extractFirstSentence(text: string): string {
  // 去掉可能的标题行
  const cleaned = text.replace(/^#.*\n?/, '').trim();
  const match = cleaned.match(/^[^。！？\n]+[。！？]?/);
  return match ? match[0] : cleaned.slice(0, 50);
}

function extractLastSentence(text: string): string {
  const sentences = text.split(/[。！？\n]+/).filter(s => s.trim());
  return sentences.length > 0 ? sentences[sentences.length - 1].trim() : '';
}

export function classifyOpening(sentence: string): string {
  const s = sentence.slice(0, 20);

  if (/^[""「]/.test(s) || /.{0,4}[说道喊叫吼问答笑]/ .test(s.slice(0, 10))) return 'dialogue';
  if (/[雨雪风雷云天黑夜晨暮阳月星空]/ .test(s.slice(0, 3))) return 'weather';
  if (/[跑走跳站坐打劈刺踢拔抽挥握踏冲扑]/ .test(s.slice(0, 5))) return 'action';
  if (/[他想她想心中内心灵魂脑海叶.*想]/ .test(s.slice(0, 8))) return 'thought';
  if (/[叮咚嗡轰咔砰嗤嘶嘀滴答]/ .test(s.slice(0, 4))) return 'sound';
  return 'description';
}

function jaccardSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const setA = new Set(a.split(''));
  const setB = new Set(b.split(''));
  const intersection = [...setA].filter(c => setB.has(c)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}
