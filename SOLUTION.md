# 小说生成智能体 — 解决方案设计

> 核心思路：不推倒重来，在现有 1672 行代码基础上做最小架构升级
> 目标：从"批处理脚本"升级为"有感知能力的智能体"
> 原则：每一步改进都必须能独立运行、独立产生价值

---

## 零、核心设计思想

解决问题的根本不在于加多少功能，而在于**改变数据流的方向**。

### 现状：单向管道

```
Config → WorldBible → Premise → Outlines → Chapter1 → Chapter2 → ... → Chapter60
                                                                    ↓
                                                              Compile（完事）
```

每一站都在"往前冲"，没有任何一站回头看。

### 目标：闭环控制

```
                    ┌──────────────────────────────┐
                    │         State（全局状态）       │
                    │  角色位置、情绪、已知信息、       │
                    │  伏笔列表、已发生事件           │
                    └───────┬──────────┬────────────┘
                            │          │
                    写前查询 ↑          ↓ 写后更新
                            │          │
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│  Plan   │───→│  Write  │───→│ Review  │───→│ Update  │
│（规划）  │    │（生成）  │    │（审查）  │    │（更新）  │
└─────────┘    └─────────┘    └────┬────┘    └────┬────┘
                                    │               │
                              质量达标？          State 更新
                              ├── 是 → 保存      角色位置移动
                              └── 否 → 重写      新信息记录
                                              伏笔标记
```

这就是全部。不是什么复杂的框架，就是在 Write 后面加了两个步骤：
1. **Review** — 检查质量，不达标就重写
2. **Update State** — 把这章的关键信息提取出来，供后续章节使用

---

## 一、新增文件结构

```
src/
├── config.ts          # 不变
├── compiler.ts        # 不变
├── dashboard.ts       # 不变
├── index.ts           # 微调（加 reset 命令）
├── llm.ts             # 不变
├── planner.ts         # 微调（加卷数校验）
├── writer.ts          # 重写核心循环
├── prompts/
│   ├── chapter.ts     # 微调（动态 prompt）
│   ├── world.ts       # 不变
│   └── review.ts      # 【新增】审查 prompt
├── memory/
│   ├── state.ts       # 【新增】全局状态管理
│   └── summaries.ts   # 【新增】章节摘要管理
└── quality/
    └── checker.ts     # 【新增】质量检查（代码级，零成本）
```

只新增 4 个文件，重写 1 个文件，微调 3 个文件。

---

## 二、核心模块设计

### 2.1 State — 全局状态管理（最关键的新增）

这是整个升级的灵魂。维护一个 `state.json`，记录写作过程中的"活"信息。

```typescript
// src/memory/state.ts

export interface WorldState {
  // 角色状态（动态追踪）
  characters: Record<string, {
    currentLocation: string;    // 当前在哪
    cultivationLevel: string;   // 当前修为
    emotionalState: string;     // 当前情绪
    knownInformation: string[]; // 角色目前知道什么
    lastAppearance: number;     // 最后出场的章节号
    status: 'active' | 'absent' | 'dead' | 'unknown';
  }>;

  // 已发生的关键事件（时间线）
  timeline: {
    chapterIndex: number;
    event: string;              // 简短描述
    impact: string;             // 影响了什么
  }[];

  // 伏笔追踪
  foreshadows: {
    id: string;
    description: string;        // 伏笔内容
    plantedInChapter: number;   // 在哪一章埋下
    resolved: boolean;          // 是否已回收
    resolvedInChapter?: number; // 在哪一章回收
    priority: 'high' | 'medium' | 'low';
  }[];

  // 最近章节的开头模式（用于去重）
  recentOpenings: {
    chapterIndex: number;
    firstSentence: string;      // 第一句话
    openingType: string;        // 'weather' | 'dialogue' | 'action' | 'thought' | 'description'
  }[];

  // 元数据
  lastUpdatedChapter: number;
}
```

**关键设计决策：为什么 state 是 JSON 而不是让 LLM 自己记住？**

因为 JSON 是**确定性的**。LLM 可能忘记，但 JSON 不会。State 就是"系统的确定性记忆"，LLM 每次调用时从这个确定性的记忆中读取信息，而不是靠自己的上下文窗口去回忆。

#### State 的写入时机

每章写完后，调用一次 LLM 做结构化提取（一次额外的 API 调用），更新 state：

```
你是一个信息提取助手。请从以下章节内容中提取结构化信息，以 JSON 格式输出。

需要提取：
1. 出场角色及其状态变化（位置、情绪、修为、获知的新信息）
2. 发生的关键事件
3. 新埋下的伏笔或已回收的伏笔
4. 本章第一句话的开头类型（weather/dialogue/action/thought/description）

章节内容：
[章节全文]

请严格按以下 JSON 格式输出：
{
  "characters": { "角色名": { "location": "...", ... } },
  "events": [{ "event": "...", "impact": "..." }],
  "newForeshadows": ["..."],
  "resolvedForeshadows": ["..."],
  "openingType": "weather"
}
```

#### State 的读取时机

写每章前，从 state 中提取相关信息，注入 prompt：

```
你即将写作第 32 章。以下是当前的世界状态：

## 活跃角色状态
- 叶尘：位于演算宗内门，筑基期，情绪：警惕。上次出场：第31章。
  已知信息：[知道宗门有内鬼，知道墨无涯被困]
- 苏瑶儿：位于演算宗外门，炼气期巅峰。上次出场：第30章。

## 未回收的伏笔
- [高优] 第8章埋下：断罪之剑中封印的残魂尚未觉醒
- [中优] 第15章埋下：云长老留下的暗号尚未解读
- [低优] 第22章埋下：苏瑶儿手上的神秘印记

## 最近的章节开头模式
- 第30章：对话开头（"你疯了！"苏瑶儿一把抓住叶尘的手腕。）
- 第31章：动作开头（叶尘翻过院墙，双脚无声落地。）
→ 请避免再用对话或动作开头，可以尝试心理描写或环境白描。

## 最近的关键事件
- 第31章：叶尘发现演算宗长老秘密通信
```

这就是"记忆"——**不是让 LLM 记住，而是每次提醒它**。

---

### 2.2 Quality Checker — 零成本质量检查

不调 LLM，纯代码检查。每次生成后立即运行：

```typescript
// src/quality/checker.ts

export interface QualityReport {
  passed: boolean;
  score: number;              // 0-100
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

  // 1. 字数检查
  const charCount = content.replace(/[^\u4e00-\u9fff]/g, '').length;
  const targetWords = outline.targetWords;
  if (charCount < targetWords * 0.6) {
    issues.push({ type: 'word_count', severity: 'error',
      message: `字数不足：${charCount} 字，目标 ${targetWords} 字` });
    score -= 30;
  } else if (charCount < targetWords * 0.8) {
    issues.push({ type: 'word_count', severity: 'warning',
      message: `字数偏少：${charCount} 字，目标 ${targetWords} 字` });
    score -= 10;
  }

  // 2. 开头重复检查
  const firstSentence = content.split(/[。！？\n]/)[0];
  const recentOpenings = state.recentOpenings.slice(-5);
  for (const opening of recentOpenings) {
    const similarity = computeSimilarity(firstSentence, opening.firstSentence);
    if (similarity > 0.5) {
      issues.push({ type: 'opening_duplicate', severity: 'error',
        message: `开头与第${opening.chapterIndex + 1}章过于相似（相似度${(similarity * 100).toFixed(0)}%）` });
      score -= 25;
    }
  }

  // 3. 开头类型检查
  const openingType = classifyOpening(firstSentence);
  const recentTypes = recentOpenings.slice(-3).map(o => o.openingType);
  if (recentTypes.filter(t => t === openingType).length >= 2) {
    issues.push({ type: 'opening_pattern', severity: 'warning',
      message: `最近章节已多次使用"${openingType}"类开头` });
    score -= 15;
  }

  // 4. 结尾套路检查
  const lastSentence = content.trim().split(/[。！？\n]/).pop() || '';
  const cliches = [
    /一切.*才.*刚刚.*开始/,
    /才.*刚刚.*开始/,
    /风起.*云涌/,
    /新的.*即将.*开始/,
    /真正的.*才.*开始/,
    /注定.*不.*平静/,
  ];
  for (const pattern of cliches) {
    if (pattern.test(lastSentence)) {
      issues.push({ type: 'cliche_ending', severity: 'warning',
        message: `结尾疑似套路句："${lastSentence}"` });
      score -= 10;
    }
  }

  // 5. 内容截断检查
  if (content.endsWith('…') || content.endsWith('...') || content.endsWith('—')) {
    issues.push({ type: 'truncated', severity: 'error',
      message: '章节可能被截断（以省略号或破折号结尾）' });
    score -= 20;
  }

  // 6. LLM 元信息残留检查
  const metaPatterns = [/^(好的|以下是|根据)/, /\(本章完\)/, /\[字数[：:]/];
  for (const p of metaPatterns) {
    if (p.test(content)) {
      issues.push({ type: 'meta_residual', severity: 'warning',
        message: '内容中残留 LLM 元信息' });
      score -= 5;
    }
  }

  return {
    passed: score >= 60,
    score,
    issues,
    shouldRewrite: score < 50,
  };
}

// 工具函数
function classifyOpening(sentence: string): string {
  if (/^[""「]/.test(sentence) || /.{2,5}[说道喊叫吼问答笑]/.test(sentence.slice(0, 10))) return 'dialogue';
  if (/[雨雪风雷云天黑夜晨暮阳]/ .test(sentence.slice(0, 3))) return 'weather';
  if (/[跑走跳站坐打劈刺踢]/.test(sentence.slice(0, 5))) return 'action';
  if (/[他想她想叶尘想|心想|心中|内心]/.test(sentence.slice(0, 8))) return 'thought';
  return 'description';
}

function computeSimilarity(a: string, b: string): number {
  // 简单的字符重叠度
  if (a === b) return 1;
  const setA = new Set(a.split(''));
  const setB = new Set(b.split(''));
  const intersection = [...setA].filter(c => setB.has(c)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}
```

这个检查器：
- **零 API 调用成本**
- 在 10ms 内完成
- 能捕获：字数不足、开头重复、结尾套路、内容截断、元信息残留

---

### 2.3 Review Agent — LLM 级质量审查

在代码级检查通过后，选择性调用 LLM 做更深入的评估。

**关键：不是每章都调，而是有策略地调用**：

```typescript
// src/prompts/review.ts

export function buildReviewPrompt(
  content: string,
  outline: ChapterOutline,
  stateSummary: string,
): string {
  return `你是一位严格的小说编辑。请审查以下章节。

## 本章大纲要求
标题：${outline.title}
概要：${outline.summary}
关键场景：${outline.keyScenes.join('；')}
情绪基调：${outline.mood}
${outline.cliffhanger ? `章末悬念：${outline.cliffhanger}` : ''}

## 当前故事状态
${stateSummary}

## 章节内容
${content}

---

请从以下维度评分（1-10分），并简要说明扣分原因：

1. **情节完成度**：本章是否完成了大纲中要求的关键场景？
2. **角色一致性**：角色的言行是否符合其性格和当前状态？
3. **上下文连贯性**：与前文的衔接是否自然？是否有逻辑矛盾？
4. **文笔质量**：描写是否生动？对话是否自然？节奏是否合理？
5. **吸引力**：作为读者，你会想继续读下去吗？

请严格按以下 JSON 格式输出：
{
  "scores": {
    "plotCompletion": 8,
    "characterConsistency": 7,
    "contextCoherence": 9,
    "writingQuality": 8,
    "attractiveness": 7
  },
  "overallScore": 7.8,
  "issues": ["具体问题1", "具体问题2"],
  "highlights": ["写得好的地方"],
  "rewriteAdvice": "如果不达标，应该怎么改"
}`;
}

// 何时调用 Review Agent
export function shouldRunLLMReview(chapterIndex: number, codeCheckScore: number): boolean {
  // 条件 1：代码检查分数在 50-70 之间（边缘地带，需要 LLM 判断）
  if (codeCheckScore >= 50 && codeCheckScore < 70) return true;

  // 条件 2：每卷的第一章和最后一章（关键节点）
  if (chapterIndex % 10 === 0 || chapterIndex % 10 === 9) return true;

  // 条件 3：每 5 章抽检一次
  if (chapterIndex % 5 === 0) return true;

  return false;
}
```

---

### 2.4 改造后的 Writer — 核心循环重写

这是把所有模块串起来的地方。当前的 `for` 循环变成：

```typescript
// src/writer.ts 核心循环（伪代码，展示逻辑）

for (const chapter of allChapters) {
  // ── 写前 ──
  const state = loadState();
  const context = buildContextFromState(state, chapter);
  // context 包含：角色状态、未回收伏笔、最近开头模式、最近事件

  // ── 生成（最多重试 3 次）──
  let content: string;
  let passed = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    content = await generateChapter(config, context, chapter);

    // ── 代码级质量检查（零成本）──
    const codeReport = checkQuality(content, chapter.globalIndex, state, chapter);

    if (codeReport.passed) {
      // 可选：LLM 级审查
      if (shouldRunLLMReview(chapter.globalIndex, codeReport.score)) {
        const llmReport = await llmReview(content, chapter, state);
        if (llmReport.overallScore >= 6.5) {
          passed = true;
          break;
        }
      } else {
        passed = true;
        break;
      }
    }

    // 不通过 → 调整 prompt 后重试
    // 把 quality issues 注入下一次的 prompt 作为"要避免的问题"
    context.qualityFeedback = codeReport.issues;
  }

  // ── 保存 ──
  saveChapter(content);

  // ── 更新状态（一次额外 API 调用）──
  const stateUpdate = await extractStateUpdate(content, chapter);
  updateState(state, stateUpdate);

  // ── 更新摘要 ──
  const summary = await generateSummary(content, chapter);
  saveSummary(chapter.globalIndex, summary);
}
```

---

### 2.5 Summaries — 真正的章节摘要

当前系统用 `head 300字 + tail 200字` 作为"摘要"。这完全不是摘要。

```typescript
// src/memory/summaries.ts

export interface ChapterSummary {
  chapterIndex: number;
  title: string;
  // 结构化摘要
  plotProgress: string;          // 情节推进了什么
  characterChanges: string[];    // 角色发生了什么变化
  newInformation: string[];      // 揭示了什么新信息
  foreshadowsPlanted: string[];  // 埋下了什么伏笔
  foreshadowsResolved: string[]; // 回收了什么伏笔
  emotionalArc: string;          // 情绪走向（如：紧张→绝望→希望）
  endingHook: string;            // 章末悬念
  // 原始文本摘要（给 LLM 看的）
  narrativeSummary: string;      // 200-300字叙事摘要
}
```

**关键**：写完每章后花一次 API 调用生成摘要，存入 `summaries.json`。写作时传入最近 5-10 章的结构化摘要，比传原文头尾有效得多。

为什么？
- 5 章 × 300字摘要 = 1500字，但包含全部关键信息
- 5 章 × 原文头尾 = 2500字，但中间的关键信息全丢了
- 摘要是**压缩后的有效信息**，头尾拼接是**随机截取的碎片**

---

## 三、成本分析

这是最实际的问题。改动后的额外 API 消耗：

| 步骤 | 每章额外调用 | Token 估算 | 成本（glm-4-flash） |
|------|------------|-----------|-------------------|
| State 提取 | 1 次 | ~1000 token | ¥0.001 |
| LLM Review | ~0.3 次（不是每章都调） | ~800 token | ¥0.0003 |
| 章节摘要 | 1 次 | ~800 token | ~¥0.001 |
| **合计每章** | **~1.3 次** | **~2600 token** | **~¥0.002** |
| **60 章合计** | **~78 次** | **~156K token** | **~¥0.12** |

额外成本大约是**一两毛钱**，换来的是：
- 开头不再重复
- 角色行为一致性
- 伏笔有跟踪
- 质量有保障

**这是目前性价比最高的改进。**

---

## 四、为什么不用更复杂的方案

有人可能会问：为什么不用 LangChain / AutoGen / CrewAI 这些框架？

**因为这些框架解决的问题和这里不同。**

- LangChain 解决的是"链式调用"的问题——但这里的链很简单（写→审→更新），不需要框架
- AutoGen 解决的是"多 Agent 协作"的问题——但这里的 Agent 数量很少（Writer + Reviewer），协作模式简单
- CrewAI 解决的是"角色分工"的问题——但这里角色是固定的，不需要动态编排

用这些框架引入的复杂度远大于它们解决的问题。**一个 state.json + 三个函数（checkQuality / extractState / buildContext）就能覆盖 80% 的改进收益。**

同样，也不需要向量数据库。小说的结构化信息（角色状态、事件、伏笔）天然适合 JSON 存储，不需要语义检索。只有当世界设定书大到无法放入 prompt 时才需要考虑，而目前 1 万字的世界设定书完全在 LLM 窗口范围内。

---

## 五、实施顺序

```
Phase 1（1天，立即见效）：
  ├── 新建 src/quality/checker.ts     （零成本质量检查）
  ├── 新建 src/memory/state.ts        （State 数据结构 + 读写）
  └── 改造 src/writer.ts              （加 checkQuality + 重试）

Phase 2（1天，闭环运转）：
  ├── 新建 src/prompts/review.ts      （审查 prompt）
  ├── 新建 src/memory/summaries.ts    （摘要管理）
  └── 改造 src/writer.ts              （加 state 更新 + 摘要生成）

Phase 3（1天，上下文增强）：
  ├── 改造 src/prompts/chapter.ts     （动态 prompt，注入 state 信息）
  └── 改造 src/planner.ts             （加卷数校验 + 大纲修正）

总计：3天，~500行新代码，覆盖 80% 的改进收益。
```

Phase 1 完成后就能立刻看到效果——开头不再重复、字数不达标的章节自动重写。
Phase 2 完成后系统具备了"记忆"——角色状态不再漂移、伏笔不再遗忘。
Phase 3 完成后 prompt 变得"聪明"——每章的写作指令都是基于当前状态动态生成的。

---

## 六、最终架构

```
改造前（线性管道）：

  Plan ──→ Write ──→ Save ──→ Next ──→ ... ──→ Compile

改造后（闭环控制）：

        ┌──────────────────────────────────────┐
        │                                      │
        │  ┌───────┐                           │
        │  │ State │ ←←←←←←←←←←←←←←←←←←←←←  │
        │  └───┬───┘                          │ │
        │      │ 读                           │ │ 写
        │      ↓                              │ │
        │  ┌───────┐    ┌────────┐    ┌─────┐ │ │
        │  │ Write │───→│ Check  │───→│Save │ │ │
        │  └───────┘    └───┬────┘    └──┬──┘ │ │
        │                   │              │    │ │
        │              通过？│              │    │ │
        │              ┌──┘              │    │ │
        │              │ 否→重试          │    │ │
        │              ↓ 是              ↓    │ │
        │         ┌──────────┐    ┌──────────┐ │ │
        │         │(可选)Review│    │Update    │ │ │
        │         │  LLM评估  │    │State     │─┘ │
        │         └──────────┘    └──────────┘   │
        │                                        │
        └────────────────────────────────────────┘
```

就这些。不多不少。**一个 State，一个 Check，一个 Review。** 把这三件事做好，系统就从"批处理脚本"变成了"有感知能力的智能体"。
