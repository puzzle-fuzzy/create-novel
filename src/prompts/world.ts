// 提示词模板 - 世界观与大纲生成

export function buildWorldBiblePrompt(config: import('./config').NovelConfig): string {
  const { worldSetting, characters, writingStyle, plotFramework, generation } = config;

  return `你是一位经验丰富的网文编辑和世界观架构师。请根据以下设定，生成一份详细的"世界设定书"（World Bible）。

## 小说基本信息
- **书名**：${worldSetting.name}
- **题材**：${worldSetting.genre}
- **目标字数**：约 ${config.targetLength} 字
- **结构**：${generation.volumeCount} 卷，每卷 ${generation.chaptersPerVolume} 章，每章约 ${generation.wordsPerChapter} 字

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

请生成一份完整的世界设定书，包含以下部分：

1. **世界总览**：详细描述这个世界的全貌、历史、文明程度
2. **地理图景**：主要地点、区域、地标（至少 10 个重要地点）
3. **势力格局**：主要势力、组织、阵营及其关系
4. **力量体系详解**：修炼/科技/魔法等级、规则、限制
5. **历史大事记**：影响世界格局的关键历史事件
6. **社会风貌**：日常生活、文化习俗、经济体系
7. **角色详细设定**：每个角色的外貌、习惯、说话方式、人际关系网络
8. **伏笔与暗线**：可以贯穿全书的伏笔、悬念、暗线设计

要求：
- 设定要足够丰富，能支撑 ${config.targetLength} 字的长篇
- 每个设定都要有矛盾和冲突空间，便于剧情展开
- 角色之间要有错综复杂的关系网
- 保留足够的悬念和未解之谜

请用中文输出，格式清晰。`;
}

export function buildVolumeOutlinePrompt(
  config: import('./config').NovelConfig,
  worldBible: string,
  volumeIndex: number,
  totalVolumes: number,
  previousVolumeSummary?: string,
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

## 世界设定书
${worldBible}

${previousVolumeSummary ? `## 上一卷总结\n${previousVolumeSummary}\n` : ''}

## 当前卷定位
这是第 ${volumeIndex + 1} 卷（共 ${totalVolumes} 卷）。
${isFirst ? '这是第一卷，需要建立世界观、引出主角、设置主线。' : ''}
${isMiddle ? '这是中间卷，需要推进剧情、深化冲突、发展角色。' : ''}
${isLast ? '这是最后一卷，需要收束所有线索、推向高潮、完成结局。' : ''}

---

请为本卷生成详细大纲，按以下 JSON 格式输出：

\`\`\`json
{
  "title": "卷名",
  "summary": "本卷概述（200-300字，描述本卷的主要剧情走向）",
  "keyEvents": ["关键事件1", "关键事件2", "关键事件3"],
  "characterDevelopments": ["角色发展1", "角色发展2"],
  "chapters": [
    {
      "title": "章节标题",
      "summary": "章节概要（150-250字，详细描述本章要发生的事情）",
      "keyScenes": ["场景1描述", "场景2描述", "场景3描述"],
      "characters": ["出场角色1", "出场角色2"],
      "mood": "本章情绪基调",
      "cliffhanger": "章末悬念（可选，用于吸引读者继续阅读）",
      "targetWords": ${config.generation.wordsPerChapter}
    }
  ]
}
\`\`\`

要求：
1. 本卷共 ${config.generation.chaptersPerVolume} 章
2. 每章之间要有连贯性和递进感
3. 章节开头要承接上文，结尾要留有钩子
4. 注意节奏控制：铺垫→冲突→高潮→回落→新悬念
5. 确保角色行为符合其性格设定
6. 穿插伏笔和暗线

请严格按 JSON 格式输出，不要添加任何其他文字。`;
}

export function buildPremiseOutlinePrompt(config: import('./config').NovelConfig): string {
  const { worldSetting, characters, plotFramework, generation } = config;

  return `你是一位顶级网文大纲策划师。请为以下小说生成一个总体的故事脉络概要。

## 小说信息
- **书名**：${worldSetting.name}
- **题材**：${worldSetting.genre}
- **总结构**：${generation.volumeCount} 卷，每卷 ${generation.chaptersPerVolume} 章
- **目标字数**：约 ${config.targetLength} 字

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

请生成一份 500-800 字的故事总体概要（Premise），描述从开篇到结局的完整故事脉络。
要求：
1. 明确每一卷的大致内容走向
2. 标注关键转折点
3. 体现角色的成长弧线
4. 确保节奏张弛有度`;
}
