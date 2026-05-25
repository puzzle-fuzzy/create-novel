// 状态提取 prompt — 从章节内容中提取结构化信息更新 state

export function buildStateExtractionPrompt(chapterTitle: string, chapterContent: string): string {
  return `你是一个信息提取助手。请从以下章节内容中提取结构化信息。

## 章节：${chapterTitle}

${chapterContent.slice(0, 8000)}

---

请严格按以下 JSON 格式输出（不要输出任何其他文字）：

{
  "characters": {
    "角色名": {
      "location": "当前所在位置",
      "cultivationLevel": "当前修为等级（如有变化）",
      "emotionalState": "当前情绪状态",
      "newInformation": ["角色新获知的信息"],
      "status": "active"
    }
  },
  "events": [
    { "event": "发生了什么关键事件", "impact": "对剧情有什么影响" }
  ],
  "newForeshadows": ["新埋下的伏笔描述（如有）"],
  "resolvedForeshadows": ["回收了的伏笔描述（如有）"],
  "openingType": "weather 或 dialogue 或 action 或 thought 或 sound 或 description",
  "firstSentence": "章节的第一句话"
}`;
}
