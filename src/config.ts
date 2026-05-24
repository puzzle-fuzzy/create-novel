// 项目配置管理
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';

export interface Character {
  name: string;
  role: '主角' | '主要配角' | '次要配角' | '反派';
  description: string;
  personality: string;
  background: string;
  arc: string; // 角色弧线
}

export interface WorldSetting {
  name: string; // 小说名称
  genre: string; // 题材类型
  worldBackground: string; // 世界观背景
  era: string; // 时代背景
  powerSystem?: string; // 力量体系（奇幻/科幻）
  socialStructure: string; // 社会结构
  geography?: string; // 地理环境
  rules: string[]; // 世界规则/禁忌
  tone: string; // 基调风格
  themes: string[]; // 核心主题
}

export interface WritingStyle {
  perspective: string; // 叙事视角
  tense: string; // 时态
  proseStyle: string; // 文笔风格
  chapterLength: number; // 每章目标字数
  dialogueRatio: string; // 对话占比
}

export interface PlotFramework {
  mainConflict: string; // 主线冲突
  incitingIncident: string; // 触发事件
  climax: string; // 高潮
  resolution: string; // 结局走向
  subplots: string[]; // 支线剧情
}

export interface NovelConfig {
  version: string;
  worldSetting: WorldSetting;
  characters: Character[];
  writingStyle: WritingStyle;
  plotFramework: PlotFramework;
  targetLength: number; // 目标总字数
  generation: {
    volumeCount: number;
    chaptersPerVolume: number;
    wordsPerChapter: number;
  };
}

export interface VolumeOutline {
  volumeIndex: number;
  title: string;
  summary: string;
  keyEvents: string[];
  characterDevelopments: string[];
  chapters: ChapterOutline[];
}

export interface ChapterOutline {
  chapterIndex: number;
  globalIndex: number;
  title: string;
  summary: string;
  keyScenes: string[];
  characters: string[];
  mood: string;
  cliffhanger?: string;
  targetWords: number;
}

export interface FullOutline {
  novelTitle: string;
  premise: string;
  totalVolumes: number;
  totalChapters: number;
  estimatedWords: number;
  volumes: VolumeOutline[];
}

export interface Progress {
  status: 'idle' | 'planning' | 'writing' | 'paused' | 'completed' | 'error';
  currentPhase: string;
  totalChapters: number;
  completedChapters: number;
  totalWords: number;
  lastWrittenChapter: number | null;
  totalTokensUsed: number;
  errors: string[];
  startedAt: string;
  updatedAt: string;
}

export class ProjectManager {
  public readonly projectDir: string;

  constructor(projectName: string) {
    this.projectDir = join(process.cwd(), 'projects', projectName);
  }

  // Config
  get configPath() { return join(this.projectDir, 'config.yaml'); }
  get outlinePath() { return join(this.projectDir, 'outline.json'); }
  get progressPath() { return join(this.projectDir, 'progress.json'); }
  get chaptersDir() { return join(this.projectDir, 'chapters'); }
  get outputPath() { return join(this.projectDir, 'output'); }

  static listProjects(): string[] {
    const projectsDir = join(process.cwd(), 'projects');
    if (!existsSync(projectsDir)) return [];
    return readdirSync(projectsDir).filter(name =>
      statSync(join(projectsDir, name)).isDirectory()
    );
  }

  exists(): boolean {
    return existsSync(this.projectDir);
  }

  ensureDirs(): void {
    if (!existsSync(this.projectDir)) mkdirSync(this.projectDir, { recursive: true });
    if (!existsSync(this.chaptersDir)) mkdirSync(this.chaptersDir, { recursive: true });
    if (!existsSync(this.outputPath)) mkdirSync(this.outputPath, { recursive: true });
  }

  saveConfig(config: NovelConfig): void {
    this.ensureDirs();
    writeFileSync(this.configPath, YAML.stringify(config), 'utf-8');
  }

  loadConfig(): NovelConfig {
    return YAML.parse(readFileSync(this.configPath, 'utf-8')) as NovelConfig;
  }

  saveOutline(outline: FullOutline): void {
    writeFileSync(this.outlinePath, JSON.stringify(outline, null, 2), 'utf-8');
  }

  loadOutline(): FullOutline {
    return JSON.parse(readFileSync(this.outlinePath, 'utf-8')) as FullOutline;
  }

  saveProgress(progress: Progress): void {
    progress.updatedAt = new Date().toISOString();
    writeFileSync(this.progressPath, JSON.stringify(progress, null, 2), 'utf-8');
  }

  loadProgress(): Progress {
    if (!existsSync(this.progressPath)) {
      return {
        status: 'idle',
        currentPhase: '未开始',
        totalChapters: 0,
        completedChapters: 0,
        totalWords: 0,
        lastWrittenChapter: null,
        totalTokensUsed: 0,
        errors: [],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    return JSON.parse(readFileSync(this.progressPath, 'utf-8')) as Progress;
  }

  saveChapter(volumeIndex: number, chapterIndex: number, content: string): void {
    const fileName = `v${String(volumeIndex + 1).padStart(2, '0')}_c${String(chapterIndex + 1).padStart(3, '0')}.txt`;
    writeFileSync(join(this.chaptersDir, fileName), content, 'utf-8');
  }

  loadChapter(volumeIndex: number, chapterIndex: number): string | null {
    const fileName = `v${String(volumeIndex + 1).padStart(2, '0')}_c${String(chapterIndex + 1).padStart(3, '0')}.txt`;
    const filePath = join(this.chaptersDir, fileName);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  }

  getCompletedChapterFiles(): string[] {
    if (!existsSync(this.chaptersDir)) return [];
    return readdirSync(this.chaptersDir)
      .filter((f: string) => f.endsWith('.txt'))
      .sort();
  }

  compileNovel(): string {
    const outline = this.loadOutline();
    const files = this.getCompletedChapterFiles();

    let novel = '';
    novel += `${'='.repeat(60)}\n`;
    novel += `  ${outline.novelTitle}\n`;
    novel += `${'='.repeat(60)}\n\n`;

    let currentVolume = -1;
    for (const file of files) {
      const vIdx = parseInt(file.match(/v(\d+)/)?.[1] || '0') - 1;
      const cIdx = parseInt(file.match(/c(\d+)/)?.[1] || '0') - 1;

      if (vIdx !== currentVolume && vIdx < outline.volumes.length) {
        const vol = outline.volumes[vIdx];
        novel += `\n${'═'.repeat(60)}\n`;
        novel += `  第${vIdx + 1}卷：${vol.title}\n`;
        novel += `${'═'.repeat(60)}\n\n`;
        currentVolume = vIdx;
      }

      const chapter = outline.volumes[vIdx]?.chapters[cIdx];
      if (chapter) {
        novel += `${'─'.repeat(40)}\n`;
        novel += `  第${chapter.globalIndex + 1}章：${chapter.title}\n`;
        novel += `${'─'.repeat(40)}\n\n`;
      }

      novel += readFileSync(join(this.chaptersDir, file), 'utf-8');
      novel += '\n\n';
    }

    return novel;
  }
}
