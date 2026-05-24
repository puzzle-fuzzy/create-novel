// 前端 Dashboard 服务

import { ProjectManager } from './config';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export async function startDashboard(port: number = 3000) {
  console.log(`\n🌐 小说生成器 Dashboard 启动中...\n`);

  const htmlPath = join(import.meta.dir, 'dashboard', 'index.html');
  const HTML = readFileSync(htmlPath, 'utf-8');

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const pathname = decodeURIComponent(url.pathname);

      // API 路由
      if (pathname.startsWith('/api/')) {
        return handleAPI(pathname, url);
      }

      // 首页
      return new Response(HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    },
  });

  console.log(`  ✅ Dashboard 已启动：http://localhost:${port}`);
  console.log(`  按 Ctrl+C 停止\n`);
}

function handleAPI(pathname: string, url: URL): Response {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    // GET /api/projects — 项目列表 + 概览
    if (pathname === '/api/projects') {
      const projects = ProjectManager.listProjects();
      const data = projects.map(name => {
        const pm = new ProjectManager(name);
        let config = null, outline = null, progress = null;

        try { config = pm.loadConfig(); } catch {}
        try { outline = pm.loadOutline(); } catch {}
        try { progress = pm.loadProgress(); } catch {}

        // 统计已完成章节和实际字数
        const completedFiles = pm.getCompletedChapterFiles();
        let actualWordCount = 0;
        const chapterWordCounts: Record<string, number> = {};

        for (const f of completedFiles) {
          try {
            const content = readFileSync(join(pm.chaptersDir, f), 'utf-8');
            actualWordCount += content.length;
            chapterWordCounts[f] = content.length;
          } catch {}
        }

        return {
          name,
          config: config ? {
            title: config.worldSetting.name,
            genre: config.worldSetting.genre,
            targetLength: config.targetLength,
            volumeCount: config.generation.volumeCount,
            chaptersPerVolume: config.generation.chaptersPerVolume,
            wordsPerChapter: config.generation.wordsPerChapter,
          } : null,
          outline: outline ? {
            totalVolumes: outline.totalVolumes,
            totalChapters: outline.totalChapters,
            estimatedWords: outline.estimatedWords,
            volumes: outline.volumes.map((v: any) => ({
              volumeIndex: v.volumeIndex,
              title: v.title,
              summary: v.summary,
              chapters: v.chapters.map((c: any) => ({
                chapterIndex: c.chapterIndex,
                globalIndex: c.globalIndex,
                title: c.title,
                summary: c.summary,
                mood: c.mood,
                targetWords: c.targetWords,
              })),
            })),
          } : null,
          progress: progress ? {
            ...progress,
            actualWordCount,
            completedFiles: completedFiles.length,
            chapterWordCounts,
          } : null,
        };
      });

      return new Response(JSON.stringify(data), { headers });
    }

    // GET /api/projects/:name/chapter?v=0&c=0 — 读取某章内容
    const chapterMatch = pathname.match(/^\/api\/projects\/(.+)\/chapter$/);
    if (chapterMatch) {
      const projectName = chapterMatch[1];
      const vIdx = parseInt(url.searchParams.get('v') || '0');
      const cIdx = parseInt(url.searchParams.get('c') || '0');

      const pm = new ProjectManager(projectName);
      const content = pm.loadChapter(vIdx, cIdx);

      if (content) {
        return new Response(JSON.stringify({
          volumeIndex: vIdx,
          chapterIndex: cIdx,
          content,
          wordCount: content.length,
        }), { headers });
      } else {
        return new Response(JSON.stringify({ error: '章节不存在', content: null }), { status: 404, headers });
      }
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
