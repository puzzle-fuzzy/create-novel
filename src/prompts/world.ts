// 提示词模板 - 世界观与大纲生成

export function buildWorldBiblePrompt(config: import('../config').NovelConfig): string {
  const { worldSetting, characters, writingStyle, plotFramework, generation } = config;

  return `你是一位经验丰富的网文编辑和世界观架构师。请根据以下设定，生成一份详细的"世界设定书"（World Bible）。

## 小说基本信息
- **书名**：${worldSetting.name}
- **题材**：${worldSetting.genre}
- **目标字数**：约 ${config.targetLength} 字
- **结构**：${generation.volumeCount} 卷，每卷 ${generation.chaptersPerVolume} 章，每章约 ${generation.wordsPerChapter} 字
- **总章数**：${generation.volumeCount * generation.chaptersPerVolume} 章

## 世界观背景
${worldSetting.worldBackground}

## 时代背景
${worldSetting.era}

## 社会结构
${worldSetting.socialStructure}

${worldSetting.powerSystem ? `## 力量体系\n${worldSetting.powerSystem}` : ''}

${worldSetting.geography ? `## 地理环境\n${worldSetting.geography}` : ''}

## 世界规则
${worldSetting.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

## 核心角色
${characters.map(c => `
### ${c.name}（${c.role}）
- **描述**：${c.description}
- **性格**：${c.personality}
- **背景**：${c.background}
- **角色弧线**：${c.arc}
`).join('\n')}

## 写作风格
- **叙事视角**：${writingStyle.perspective}
- **文笔风格**：${writingStyle.proseStyle}
- **基调**：${worldSetting.tone}

## 剧情框架
- **主线冲突**：${plotFramework.mainConflict}
- **触发事件**：${plotFramework.incitingIncident}
- **高潮**：${plotFramework.climax}
- **结局走向**：${plotFramework.resolution}
- **支线剧情**：${plotFramework.subplots.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## 核心主题
${worldSetting.themes.map(t => `- ${t}`).join('\n')}

---

这是一部超长篇小说（${config.targetLength} 字），需要足够丰富的设定来支撑 ${generation.volumeCount} 卷的展开。请生成一份完整的世界设定书，包含以下部分：

1. **世界总览**：详细描述这个世界的全貌、历史、文明程度，要有足够的深度支撑长篇叙事
2. **地理图景**：至少 25 个重要地点，包括不同区域的地标、秘境、城市，分布在不同地理区域以便后续卷章展开
3. **势力格局**：主要势力、组织、阵营及其复杂关系网（至少 10 个势力）
4. **力量体系详解**：修炼/科技/魔法等级、规则、限制、突破条件、特殊能力
5. **历史大事记**：至少 20 个影响世界格局的关键历史事件，时间跨度要大
6. **社会风貌**：日常生活、文化习俗、经济体系、不同地区的文化差异
7. **角色详细设定**：每个角色的外貌、习惯、说话方式、人际关系网络、成长路线
8. **伏笔与暗线**：至少 15 个可以贯穿全书的伏笔、悬念、暗线设计，标注预计在哪些卷回收

要求：
- 设定要极其丰富，能支撑 ${config.targetLength} 字的超长篇
- 地点和势力要分布在多个区域，为后续不同卷提供不同的舞台
- 每个设定都要有矛盾和冲突空间，便于剧情展开
- 角色之间要有错综复杂的关系网
- 保留大量的悬念和未解之谜，分散在不同卷中逐步揭示

请用中文输出，格式清晰。`;
}

export function buildArcOutlinePrompt(config: import('../config').NovelConfig): string {
  const { plotFramework, generation } = config;

  return `你是一位顶级长篇小说策划师。请为以下小说规划多篇（Arc）结构。

## 小说信息
- **主线冲突**：${plotFramework.mainConflict}
- **触发事件**：${plotFramework.incitingIncident}
- **高潮**：${plotFramework.climax}
- **结局**：${plotFramework.resolution}
- **支线**：${plotFramework.subplots.join('；')}
- **总结构**：${generation.volumeCount} 卷，每卷 ${generation.chaptersPerVolume} 章

---

请将 ${generation.volumeCount} 卷分为 5-7 个篇（Arc），每篇 3-5 卷。每篇有自己的子冲突和小高潮，同时推进主线。

严格按以下 JSON 格式输出：
\`\`\`json
{
  "arcs": [
    {
      "title": "篇名",
      "volumeRange": { "start": 0, "end": 4 },
      "summary": "本篇概述（100-200字）",
      "subConflict": "本篇的子冲突",
      "keyCharacters": ["本篇核心角色"],
      "climax": "本篇高潮事件",
      "resolution": "本篇子冲突如何解决",
      "connectsTo": "如何衔接到下一篇"
    }
  ]
}
\`\`\`

要求：
1. 第一篇是开篇，引入世界观和主角，触发事件发生
2. 最后一篇是终章，所有线索收束，主线冲突解决
3. 中间篇要有递进感，每篇的子冲突逐步升级
4. 每篇结束后要为下一篇留下衔接点
5. 确保角色的成长弧线在各篇中均衡分布

请严格按 JSON 格式输出，不要添加任何其他文字。`;
}

export function buildVolumeOutlinePrompt(
  config: import('../config').NovelConfig,
  worldBible: string,
  volumeIndex: number,
  totalVolumes: number,
  previousVolumeSummary: string | undefined,
  arcContext?: { arc: import('../config').ArcDefinition; arcSummary?: string; completedVolumeSummaries?: string[] },
): string {
  const { plotFramework } = config;
  const isFirst = volumeIndex === 0;
  const isLast = volumeIndex === totalVolumes - 1;
  const isMiddle = !isFirst && !isLast;

  return `你是一位经验丰富的网文大纲策划师。请为以下小说生成第 ${volumeIndex + 1} 卷的详细大纲。

## 小说剧情框架
- **主线冲突**：${plotFramework.mainConflict}
- **触发事件**：${plotFramework.incitingIncident}
- **高潮**：${plotFramework.climax}
- **结局走向**：${plotFramework.resolution}

## 世界设定书（精简）
${worldBible.slice(0, 3000)}...

${arcContext ? `## 当前篇信息\n篇名：${arcContext.arc.title}\n篇概述：${arcContext.arc.summary}\n篇子冲突：${arcContext.arc.subConflict}\n篇高潮：${arcContext.arc.climax}\n\n这是本篇的第 ${volumeIndex - arcContext.arc.volumeRange.start + 1} 卷（共 ${arcContext.arc.volumeRange.end - arcContext.arc.volumeRange.start + 1} 卷）。\n${arcContext.arcSummary ? `已完成篇摘要：\n${arcContext.arcSummary}\n` : ''}` : ''}

${arcContext?.completedVolumeSummaries?.length ? `## 本篇已完成卷摘要\n${arcContext.completedVolumeSummaries.join('\n')}\n` : ''}

${previousVolumeSummary ? `## 上一卷总结\n${previousVolumeSummary}\n` : ''}

## 当前卷定位
这是第 ${volumeIndex + 1} 卷（共 ${totalVolumes} 卷）。
${isFirst ? '这是第一卷，需要建立世界观、引出主角、设置主线。' : ''}
${isMiddle ? '这是中间卷，需要推进剧情、深化冲突、发展角色。' : ''}
${isLast ? '这是最后一卷，需要收束所有线索、推向高潮、完成结局。' : ''}

---

请为本卷生成详细大纲，按以下 JSON 格式输出。

注意：本卷有 ${config.generation.chaptersPerVolume} 章。必须严格控制输出长度！每章 summary 不超过50字，keyScenes 只写1条。确保 JSON 完整闭合。

\`\`\`json
{
  "title": "卷名",
  "summary": "本卷概述（100字）",
  "keyEvents": ["事件1", "事件2"],
  "characterDevelopments": ["发展1"],
  "chapters": [
    {
      "title": "章节标题",
      "summary": "50字以内概要",
      "keyScenes": ["场景1"],
      "characters": ["角色1"],
      "mood": "情绪",
      "targetWords": ${config.generation.wordsPerChapter}
    }
  ]
}
\`\`\`

要求：
1. 本卷共 ${config.generation.chaptersPerVolume} 章
2. 每章 summary 必须50字以内
3. keyScenes 每章只写1条
4. keyEvents 最多2条
5. **JSON 必须完整闭合，不要被截断！这是最重要的要求**

请严格按 JSON 格式输出，不要添加任何其他文字。`;
}

export function buildPremiseOutlinePrompt(config: import('../config').NovelConfig): string {
  const { worldSetting, characters, plotFramework, generation } = config;

  return `你是一位顶级网文大纲策划师。请为以下超长篇小说生成一个总体的故事脉络概要。

## 小说信息
- **书名**：${worldSetting.name}
- **题材**：${worldSetting.genre}
- **总结构**：${generation.volumeCount} 卷，每卷 ${generation.chaptersPerVolume} 章
- **目标字数**：约 ${config.targetLength} 字
- **总章数**：${generation.volumeCount * generation.chaptersPerVolume} 章

## 世界观
${worldSetting.worldBackground}

## 核心角色
${characters.map(c => `- **${c.name}**（${c.role}）：${c.description}，性格：${c.personality}`).join('\n')}

## 剧情框架
- **主线冲突**：${plotFramework.mainConflict}
- **触发事件**：${plotFramework.incitingIncident}
- **高潮**：${plotFramework.climax}
- **结局走向**：${plotFramework.resolution}
- **支线**：${plotFramework.subplots.join('；')}

---

请生成一份 800-1200 字的故事总体概要（Premise），描述从开篇到结局的完整故事脉络。
这是一部 ${config.targetLength} 字的超长篇，需要详细的规划。
要求：
1. 明确每 5-8 卷的大致内容走向（按阶段划分）
2. 标注关键转折点（至少 5 个）
3. 体现角色的长期成长弧线
4. 确保节奏张弛有度，避免中期疲软
5. 指出各阶段的地域变化（不同卷在不同地方发生）`;
}
