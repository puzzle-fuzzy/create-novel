# 📚 小说生成智能体

AI 驱动的长篇小说自动生成器，目标生成约 **20 万字** 的完整小说。

## ✨ 特性

- 🌍 **自定义世界观**：交互式设定世界背景、角色、力量体系
- 📋 **自动生成大纲**：AI 自动生成世界设定书 + 分卷分章大纲
- ✍️ **逐章智能写作**：上下文感知的章节生成，保持故事连贯
- 🔄 **断点续写**：支持中断后从上次位置继续
- 📊 **进度追踪**：实时查看字数、章节数、Token 消耗
- 📦 **一键编译**：输出完整 TXT 格式小说 + 统计报告

## 🚀 快速开始

### 1. 安装依赖

```bash
bun install
```

### 2. 配置 API Key

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env，填入你的 API Key
```

支持所有 OpenAI 兼容格式的 API：

| 提供商 | LLM_BASE_URL | 推荐 |
|--------|-------------|------|
| DeepSeek | `https://api.deepseek.com/v1` | ⭐ 推荐 |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | ⭐ 推荐 |
| GLM 智谱 | `https://open.bigmodel.cn/api/paas/v4` | |
| Moonshot | `https://api.moonshot.cn/v1` | |
| OpenAI | `https://api.openai.com/v1` | |

### 3. 初始化项目

```bash
bun run init
```

按提示输入小说的世界观、角色、剧情框架等设定。

### 4. 一键生成

```bash
bun run start
```

这将自动执行：生成大纲 → 逐章写作 → 编译输出。

## 📖 分步使用

```bash
bun run plan      # 生成详细大纲
bun run write     # 开始逐章写作（可中断后重新运行续写）
bun run compile   # 编译最终小说
bun run status    # 查看进度
```

## 📁 项目结构

```
.
├── .env                    # API 配置（需自行创建）
├── .env.example            # 配置模板
├── src/
│   ├── index.ts            # 主入口 & CLI
│   ├── config.ts           # 配置管理 & 数据类型
│   ├── llm.ts              # LLM API 客户端
│   ├── planner.ts          # 大纲生成器
│   ├── writer.ts           # 章节写作者
│   ├── compiler.ts         # 小说编译器
│   └── prompts/
│       ├── world.ts        # 世界观提示词
│       └── chapter.ts      # 章节写作提示词
├── projects/               # 项目数据
│   └── <项目名>/
│       ├── config.yaml     # 世界观配置
│       ├── world_bible.txt # 世界设定书
│       ├── outline.json    # 完整大纲
│       ├── progress.json   # 进度追踪
│       ├── chapters/       # 各章节内容
│       └── output/         # 最终输出
```

## 🎯 生成策略

目标 **20 万字**，按以下结构生成：

- **8 卷**，每卷 **10 章**，每章约 **2500 字**
- 每卷有独立的剧情走向和冲突
- 章节之间有上下文衔接
- 每章结尾留有悬念钩子

## ⚙️ 高级配置

编辑 `projects/<项目名>/config.yaml` 可微调：

- 调整卷数、章数、每章字数
- 增加更多角色和支线
- 修改写作风格和叙事视角
- 添加更多世界观细节

## 💡 使用建议

1. **API 选择**：推荐使用 DeepSeek（性价比高）或通义千问（中文质量好）
2. **大纲微调**：生成大纲后可以先检查 `outline.json`，修改不满意的章节
3. **断点续写**：网络中断或 API 限流后，重新运行 `bun run write` 会自动跳过已完成章节
4. **Token 消耗**：20 万字大约需要消耗 200-400 万 Token（取决于模型）
5. **耗时**：取决于 API 速度，大约需要数小时
