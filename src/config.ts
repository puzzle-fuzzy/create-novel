// 项目配置管理
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';

// ============================================================
// 基础类型
// ============================================================

export interface Character {
  name: string;
  role: '主角' | '主要配角' | '次要配角' | '反派';
  description: string;
  personality: string;
  background: string;
  arc: string;
}

export interface WorldSetting {
  name: string;
  genre: string;
  worldBackground: string;
  era: string;
  powerSystem?: string;
  socialStructure: string;
  geography?: string;
  rules: string[];
  tone: string;
  themes: string[];
}

export interface WritingStyle {
  perspective: string;
  tense: string;
  proseStyle: string;
  chapterLength: number;
  dialogueRatio: string;
}

// ============================================================
// 篇（Arc）定义 — 多篇结构支撑 200 万字
// ============================================================

export interface ArcDefinition {
  arcIndex: number;
  title: string;
  volumeRange: { start: number; end: number };
  summary: string;
  subConflict: string;
  keyCharacters: string[];
  climax: string;
  resolution: string;
  connectsTo: string;
}

export interface PlotFramework {
  mainConflict: string;
  incitingIncident: string;
  climax: string;
  resolution: string;
  subplots: string[];
  arcs?: ArcDefinition[];
}

// ============================================================
// 配置
// ============================================================

export interface NovelConfig {
  version: string;
  worldSetting: WorldSetting;
  characters: Character[];
  writingStyle: WritingStyle;
  plotFramework: PlotFramework;
  targetLength: number;
  generation: {
    volumeCount: number;
    chaptersPerVolume: number;
    wordsPerChapter: number;
    perVolumeOverrides?: Record<number, {
      chaptersPerVolume?: number;
      wordsPerChapter?: number;
    }>;
  };
}

// ============================================================
// 大纲类型
// ============================================================

export interface VolumeOutline {
  volumeIndex: number;
  arcIndex?: number;
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

// ============================================================
// 进度
// ============================================================

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
  completedVolumes?: number;
  completedArcs?: number;
  currentArcIndex?: number;
  currentVolumeIndex?: number;
  volumeWordCounts?: Record<number, number>;
}

// ============================================================
// 层级记忆类型
// ============================================================

export interface VolumeSummary {
  volumeIndex: number;
  arcIndex: number;
  title: string;
  summary: string;
  characterDevelopments: string[];
  keyEvents: string[];
  unresolvedForeshadows: string[];
  toneAndPacing: string;
}

export interface ArcSummary {
  arcIndex: number;
  volumeRange: { start: number; end: number };
  summary: string;
  characterStatusSnapshots: Record<string, {
    location: string;
    status: string;
    keyChanges: string[];
  }>;
  resolvedForeshadows: string[];
  unresolvedForeshadows: string[];
  plotAdvancement: string;
}

// ============================================================
// Agent 类型
// ============================================================

export interface AgentDecision {
  chapterGlobalIndex: number;
  timestamp: string;
  featuredCharacters: string[];
  pacing: 'fast' | 'medium' | 'slow';
  plotFocus: 'main' | 'subplot' | 'character' | 'worldbuilding';
  foreshadowsToPlant: string[];
  foreshadowsToResolve: string[];
  tone: string;
  mood: string;
  emphasis: string[];
  storyHealth?: StoryHealth;
}

export interface StoryHealth {
  foreshadowBacklog: number;
  characterNeglect: string[];
  pacingAssessment: 'too_fast' | 'too_slow' | 'good';
  consistencyWarnings: string[];
  recommendations: string[];
}

// ============================================================
// 项目管理器
// ============================================================

export class ProjectManager {
  public readonly projectDir: string;

  constructor(projectName: string) {
    this.projectDir = join(process.cwd(), 'projects', projectName);
  }

  // 基础路径
  get configPath() { return join(this.projectDir, 'config.yaml'); }
  get outlinePath() { return join(this.projectDir, 'outline.json'); }
  get progressPath() { return join(this.projectDir, 'progress.json'); }
  get chaptersDir() { return join(this.projectDir, 'chapters'); }
  get outputPath() { return join(this.projectDir, 'output'); }

  // 层级记忆路径
  get volumeSummariesDir() { return join(this.projectDir, 'summaries', 'volumes'); }
  get arcSummariesDir() { return join(this.projectDir, 'summaries', 'arcs'); }
  get stateSnapshotsDir() { return join(this.projectDir, 'state_snapshots'); }
  get agentDecisionsPath() { return join(this.projectDir, 'agent_decisions.json'); }

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
    if (!existsSync(this.volumeSummariesDir)) mkdirSync(this.volumeSummariesDir, { recursive: true });
    if (!existsSync(this.arcSummariesDir)) mkdirSync(this.arcSummariesDir, { recursive: true });
    if (!existsSync(this.stateSnapshotsDir)) mkdirSync(this.stateSnapshotsDir, { recursive: true });
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

  // Agent 决策持久化
  saveAgentDecision(decision: AgentDecision): void {
    let decisions: AgentDecision[] = [];
    if (existsSync(this.agentDecisionsPath)) {
      try { decisions = JSON.parse(readFileSync(this.agentDecisionsPath, 'utf-8')); } catch {}
    }
    decisions.push(decision);
    writeFileSync(this.agentDecisionsPath, JSON.stringify(decisions, null, 2), 'utf-8');
  }

  loadAgentDecisions(): AgentDecision[] {
    if (!existsSync(this.agentDecisionsPath)) return [];
    try { return JSON.parse(readFileSync(this.agentDecisionsPath, 'utf-8')); } catch { return []; }
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
