// 小说生成器 - 主入口

import { ProjectManager, type NovelConfig } from './config';
import { generateFullOutline } from './planner';
import { writeAllChapters } from './writer';
import { compileNovel } from './compiler';
import { startDashboard } from './dashboard';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';

// ============================================================
// 交互式初始化
// ============================================================

async function initProject(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('  📚 小说生成智能体 - 项目初始化');
  console.log('═'.repeat(60));
  console.log('');

  // 检查 .env
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    copyFileSync(join(process.cwd(), '.env.example'), envPath);
    console.log('📝 已创建 .env 配置文件，请先编辑 .env 填入你的 API Key');
    console.log(`   文件位置：${envPath}`);
    console.log('');
    console.log('支持的 API 提供商（均使用 OpenAI 兼容格式）：');
    console.log('  - DeepSeek:    LLM_BASE_URL=https://api.deepseek.com/v1');
    console.log('  - 通义千问:     LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1');
    console.log('  - GLM智谱:      LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4');
    console.log('  - Moonshot:     LLM_BASE_URL=https://api.moonshot.cn/v1');
    console.log('  - OpenAI:       LLM_BASE_URL=https://api.openai.com/v1');
    console.log('');
    console.log('填好 API Key 后，再次运行 bun run init 开始创建项目');
    process.exit(0);
  }

  // 加载 .env
  loadEnvFile();

  // 检查 API Key
  if (!process.env.LLM_API_KEY || process.env.LLM_API_KEY === 'your-api-key-here') {
    console.error('❌ 请在 .env 文件中设置 LLM_API_KEY');
    process.exit(1);
  }

  // 交互式问答
  console.log('请回答以下问题来设定你的小说世界观：');
  console.log('（直接按 Enter 使用默认值）\n');

  const answers: Record<string, string> = {};

  const questions = [
    { key: 'name', prompt: '📖 小说名称：', default: '未命名之书' },
    { key: 'genre', prompt: '🎭 题材类型（如：玄幻/仙侠/都市/科幻/悬疑/历史）：', default: '玄幻' },
    { key: 'worldBackground', prompt: '🌍 世界观背景（描述你的故事世界）：', default: '一个灵气充沛的修仙世界，万族林立，人族在夹缝中求存' },
    { key: 'era', prompt: '⏰ 时代背景：', default: '架空世界' },
    { key: 'powerSystem', prompt: '⚡ 力量体系（如修炼等级/科技等级，可留空）：', default: '炼气、筑基、金丹、元婴、化神、渡劫、大乘、飞升' },
    { key: 'socialStructure', prompt: '🏛️ 社会结构：', default: '以宗门和世家为核心，凡人处于底层' },
    { key: 'geography', prompt: '🗺️ 地理环境（主要地点）：', default: '东荒大陆、中州、北冥海、南疆、西漠' },
    { key: 'mainCharacter', prompt: '👤 主角名字和简介：', default: '叶尘，一个被家族驱逐的少年，体内封印着神秘力量' },
    { key: 'supportingCharacters', prompt: '👥 其他重要角色（名字和简介，逗号分隔）：', default: '苏瑶儿，青梅竹马；墨无涯，亦敌亦友的天才；云长老，神秘的引路人' },
    { key: 'mainConflict', prompt: '⚔️ 主线冲突：', default: '远古封印即将破碎，灭世大劫将至，主角必须变强拯救苍生' },
    { key: 'incitingIncident', prompt: '🔥 触发事件（故事开始的契机）：', default: '主角在一次意外中觉醒了体内封印的力量' },
    { key: 'climax', prompt: '💥 高潮描述：', default: '远古封印破碎，主角率领众人对抗远古魔神' },
    { key: 'resolution', prompt: '🌅 结局走向：', default: '主角牺牲自我封印魔神，随后重生，开辟新的修炼纪元' },
    { key: 'subplots', prompt: '🔗 支线剧情（逗号分隔）：', default: '主角的身世之谜，宗门内的权力斗争，远古文明的遗藏' },
    { key: 'tone', prompt: '🎨 基调风格（如：热血/黑暗/轻松/悲壮）：', default: '热血成长' },
    { key: 'themes', prompt: '💭 核心主题（逗号分隔，如：成长,友情,正义）：', default: '成长,不屈,守护' },
    { key: 'perspective', prompt: '👁️ 叙事视角（第一人称/第三人称有限/第三人称全知）：', default: '第三人称有限视角' },
    { key: 'proseStyle', prompt: '✍️ 文笔风格（如：简洁明快/华丽优美/朴实细腻）：', default: '简洁明快，节奏紧凑，善用短句营造紧迫感' },
  ];

  for (const q of questions) {
    process.stdout.write(q.prompt + (q.default ? ` [${q.default}] ` : ' '));
    const input = await readLineAsync();
    answers[q.key] = input.trim() || q.default;
    console.log('');
  }

  // 构建配置
  await buildAndSaveProject(answers);
}

async function buildAndSaveProject(answers: Record<string, string>): Promise<void> {
  const projectName = answers.name.replace(/[^\w\u4e00-\u9fff]/g, '_');
  const pm = new ProjectManager(projectName);
  pm.ensureDirs();

  const mainCharParts = answers.mainCharacter.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const supportingParts = answers.supportingCharacters.split(/[;；]/).map(s => s.trim()).filter(Boolean);

  const characters = [];

  // 主角
  if (mainCharParts.length > 0) {
    characters.push({
      name: mainCharParts[0],
      role: '主角' as const,
      description: mainCharParts.slice(1).join('，') || '故事的主角',
      personality: '待定',
      background: '待定',
      arc: '从平凡到非凡的成长之旅',
    });
  }

  // 配角
  for (const sp of supportingParts) {
    const parts = sp.split(/\s+/);
    characters.push({
      name: parts[0],
      role: '主要配角' as const,
      description: parts.slice(1).join(' ') || '重要角色',
      personality: '待定',
      background: '待定',
      arc: '待定',
    });
  }

  if (characters.length === 0) {
    characters.push({
      name: '主角',
      role: '主角' as const,
      description: '故事的主角',
      personality: '坚韧不拔',
      background: '出身平凡',
      arc: '成长为传奇',
    });
  }

  // 计算生成参数（目标 20 万字）
  const targetLength = 200000;
  const volumeCount = 8;
  const chaptersPerVolume = 10;
  const wordsPerChapter = Math.round(targetLength / (volumeCount * chaptersPerVolume));

  const config: NovelConfig = {
    version: '1.0',
    worldSetting: {
      name: answers.name,
      genre: answers.genre,
      worldBackground: answers.worldBackground,
      era: answers.era,
      powerSystem: answers.powerSystem || undefined,
      socialStructure: answers.socialStructure,
      geography: answers.geography || undefined,
      rules: ['待世界设定书生成后确定'],
      tone: answers.tone,
      themes: answers.themes.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    },
    characters,
    writingStyle: {
      perspective: answers.perspective,
      tense: '过去时',
      proseStyle: answers.proseStyle,
      chapterLength: wordsPerChapter,
      dialogueRatio: '30%-40%',
    },
    plotFramework: {
      mainConflict: answers.mainConflict,
      incitingIncident: answers.incitingIncident,
      climax: answers.climax,
      resolution: answers.resolution,
      subplots: answers.subplots.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    },
    targetLength,
    generation: {
      volumeCount,
      chaptersPerVolume,
      wordsPerChapter,
    },
  };

  pm.saveConfig(config);
  console.log(`✅ 项目「${answers.name}」创建成功！`);
  console.log(`  📁 项目目录：${pm.projectDir}`);
  console.log(`  📋 配置文件：${pm.configPath}`);
  console.log(`  🎯 目标：${volumeCount} 卷 × ${chaptersPerVolume} 章 × ${wordsPerChapter} 字 ≈ ${targetLength} 字`);
  console.log('');
  console.log('下一步：');
  console.log('  1. 编辑 config.yaml 微调设定（可选）');
  console.log('  2. 运行 bun run plan  生成详细大纲');
  console.log('  3. 运行 bun run write 开始逐章写作');
  console.log('  4. 运行 bun run compile 编译最终小说');
  console.log('  或者直接运行 bun run start 一键完成全流程');
}

// ============================================================
// 命令路由
// ============================================================

async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'init':
      await initProject();
      break;

    case 'plan':
      loadEnvFile();
      await planCommand();
      break;

    case 'write':
      loadEnvFile();
      await writeCommand();
      break;

    case 'compile':
      await compileCommand();
      break;

    case 'status':
      await statusCommand();
      break;

    case 'start':
      loadEnvFile();
      await startCommand();
      break;

    case 'dashboard':
    case 'web':
      await startDashboard(parseInt(process.argv[3] || '3000'));
      break;

    default:
      showHelp();
  }
}

async function planCommand() {
  const pm = getProject();
  console.log('\n📋 开始生成大纲...\n');
  await generateFullOutline(pm);
}

async function writeCommand() {
  const pm = getProject();
  await writeAllChapters(pm);
}

async function compileCommand() {
  const pm = getProject();
  compileNovel(pm);
}

async function statusCommand() {
  const projects = ProjectManager.listProjects();

  if (projects.length === 0) {
    console.log('\n📭 暂无项目。运行 bun run init 创建新项目。\n');
    return;
  }

  console.log('\n📊 项目状态\n');

  for (const name of projects) {
    const pm = new ProjectManager(name);
    const progress = pm.loadProgress();

    console.log(`── ${name} ──`);
    console.log(`  状态：${statusEmoji(progress.status)} ${progress.status}`);
    console.log(`  进度：${progress.completedChapters}/${progress.totalChapters} 章`);
    console.log(`  字数：${progress.totalWords} 字（${(progress.totalWords / 10000).toFixed(1)} 万字）`);
    console.log(`  Token：${progress.totalTokensUsed}`);
    console.log(`  更新：${progress.updatedAt}`);

    if (progress.errors.length > 0) {
      console.log(`  ⚠️ 错误：${progress.errors.length} 条`);
    }
    console.log('');
  }
}

async function startCommand() {
  const pm = getProject();

  // 检查是否已有大纲
  if (!existsSync(pm.outlinePath)) {
    console.log('\n📋 第一步：生成大纲...\n');
    await generateFullOutline(pm);
  } else {
    console.log('\n📋 大纲已存在，跳过...\n');
  }

  // 写作
  console.log('\n✍️ 第二步：开始写作...\n');
  await writeAllChapters(pm);

  // 编译
  console.log('\n📦 第三步：编译输出...\n');
  compileNovel(pm);

  console.log('\n🎉 全部完成！享受你的小说吧！');
}

function showHelp() {
  console.log('');
  console.log('═'.repeat(60));
  console.log('  📚 小说生成智能体 v1.0');
  console.log('═'.repeat(60));
  console.log('');
  console.log('用法：bun run src/index.ts <命令>');
  console.log('');
  console.log('命令：');
  console.log('  init      初始化新项目（交互式设定世界观）');
  console.log('  plan      生成详细大纲（世界设定 + 卷章大纲）');
  console.log('  write     开始逐章写作（支持断点续写）');
  console.log('  compile   编译最终小说 TXT 文件');
  console.log('  status    查看所有项目状态');
  console.log('  start     一键全流程（plan → write → compile）');
  console.log('  dashboard 启动可视化面板（默认端口 3000）');
  console.log('');
  console.log('快捷脚本：');
  console.log('  bun run init      初始化');
  console.log('  bun run plan      生成大纲');
  console.log('  bun run write     开始写作');
  console.log('  bun run compile   编译输出');
  console.log('  bun run status    查看状态');
  console.log('  bun run start     一键全流程');
  console.log('  bun run dashboard 可视化面板');
  console.log('');
}

// ============================================================
// 工具函数
// ============================================================

function getProject(): ProjectManager {
  const projects = ProjectManager.listProjects();

  if (projects.length === 0) {
    console.error('❌ 暂无项目。请先运行 bun run init 创建项目。');
    process.exit(1);
  }

  if (projects.length === 1) {
    return new ProjectManager(projects[0]);
  }

  // 如果有多个项目，可以指定项目名
  const specified = process.argv[3];
  if (specified && projects.includes(specified)) {
    return new ProjectManager(specified);
  }

  console.log('发现多个项目，请通过参数指定项目名称：');
  for (const name of projects) {
    console.log(`  - ${name}`);
  }
  console.log(`\n用法：bun run src/index.ts write <项目名>`);
  process.exit(1);
}

function loadEnvFile() {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(\w+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      const cleanValue = value.trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) {
        process.env[key] = cleanValue;
      }
    }
  }
}

function statusEmoji(status: string): string {
  switch (status) {
    case 'idle': return '⚪';
    case 'planning': return '🔵';
    case 'writing': return '🟢';
    case 'paused': return '🟡';
    case 'completed': return '✅';
    case 'error': return '🔴';
    default: return '⚪';
  }
}

function readLineAsync(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');
    process.stdin.once('data', (data: string) => {
      process.stdin.pause();
      resolve(data.replace(/\r?\n$/, ''));
    });
  });
}

// 启动
main().catch(console.error);
