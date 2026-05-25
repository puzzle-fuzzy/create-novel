// 实时状态面板 — WebSocket 推送 + HTTP API

import { ProjectManager } from './config';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { WebSocketServer, type WebSocket } from 'ws';
import { onStatusEvent, getEventHistory, type StatusEvent } from './events';

const clients = new Set<WebSocket>();

export async function startDashboard(port: number = 3000) {
  console.log(`\n🌐 小说生成器 Dashboard 启动中...\n`);

  const htmlPath = join(import.meta.dir, 'dashboard', 'index.html');
  const HTML = readFileSync(htmlPath, 'utf-8');
  const authToken = process.env.DASHBOARD_TOKEN;

  const wss = new WebSocketServer({ port: port + 1 });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    // 发送历史事件
    const history = getEventHistory();
    for (const event of history) {
      try { ws.send(JSON.stringify(event)); } catch {}
    }
  });

  // 监听事件并广播
  onStatusEvent((event: StatusEvent) => {
    const data = JSON.stringify(event);
    for (const client of clients) {
      try { client.send(data); } catch {}
    }
  });

  Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      const pathname = decodeURIComponent(url.pathname);

      if (authToken && !checkAuth(req, authToken)) {
        return new Response('Unauthorized', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer realm="novel-dashboard"' },
        });
      }

      if (pathname.startsWith('/api/')) {
        return handleAPI(pathname, url);
      }

      return new Response(HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    },
  });

  console.log(`  ✅ Dashboard: http://localhost:${port}`);
  console.log(`  🔌 WebSocket: ws://localhost:${port + 1}`);
  if (authToken) console.log(`  🔒 已启用认证`);
  console.log(`  按 Ctrl+C 停止\n`);
}

function checkAuth(req: Request, token: string): boolean {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return false;
  const parts = authHeader.split(' ');
  return parts.length === 2 && parts[0] === 'Bearer' && parts[1] === token;
}

function handleAPI(pathname: string, url: URL): Response {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };

  try {
    if (pathname === '/api/projects') {
      const projects = ProjectManager.listProjects();
      const data = projects.map(name => {
        const pm = new ProjectManager(name);
        let config = null, outline = null, progress = null;
        try { config = pm.loadConfig(); } catch {}
        try { outline = pm.loadOutline(); } catch {}
        try { progress = pm.loadProgress(); } catch {}

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
            title: config.worldSetting.name, genre: config.worldSetting.genre,
            targetLength: config.targetLength, volumeCount: config.generation.volumeCount,
            chaptersPerVolume: config.generation.chaptersPerVolume,
            wordsPerChapter: config.generation.wordsPerChapter,
            arcs: config.plotFramework?.arcs || [],
          } : null,
          outline: outline ? {
            totalVolumes: outline.totalVolumes, totalChapters: outline.totalChapters,
            estimatedWords: outline.estimatedWords,
            volumes: outline.volumes.map((v: any) => ({
              volumeIndex: v.volumeIndex, arcIndex: v.arcIndex, title: v.title,
              summary: v.summary,
              chapters: v.chapters.map((c: any) => ({
                chapterIndex: c.chapterIndex, globalIndex: c.globalIndex,
                title: c.title, summary: c.summary, mood: c.mood, targetWords: c.targetWords,
              })),
            })),
          } : null,
          progress: progress ? { ...progress, actualWordCount, completedFiles: completedFiles.length, chapterWordCounts } : null,
        };
      });
      return new Response(JSON.stringify(data), { headers });
    }

    const chapterMatch = pathname.match(/^\/api\/projects\/(.+)\/chapter$/);
    if (chapterMatch) {
      const pm = new ProjectManager(chapterMatch[1]);
      const vIdx = parseInt(url.searchParams.get('v') || '0');
      const cIdx = parseInt(url.searchParams.get('c') || '0');
      const content = pm.loadChapter(vIdx, cIdx);
      if (content) {
        return new Response(JSON.stringify({ volumeIndex: vIdx, chapterIndex: cIdx, content, wordCount: content.length }), { headers });
      }
      return new Response(JSON.stringify({ error: '章节不存在' }), { status: 404, headers });
    }

    const agentLogMatch = pathname.match(/^\/api\/projects\/(.+)\/agent-log$/);
    if (agentLogMatch) {
      const pm = new ProjectManager(agentLogMatch[1]);
      return new Response(JSON.stringify(pm.loadAgentDecisions().slice(-50)), { headers });
    }

    if (pathname === '/api/events') {
      return new Response(JSON.stringify(getEventHistory()), { headers });
    }

    // 世界设定书
    const bibleMatch = pathname.match(/^\/api\/projects\/(.+)\/world-bible$/);
    if (bibleMatch) {
      const pm = new ProjectManager(bibleMatch[1]);
      const biblePath = join(pm.projectDir, 'world_bible.txt');
      if (existsSync(biblePath)) {
        return new Response(JSON.stringify({ content: readFileSync(biblePath, 'utf-8') }), { headers });
      }
      return new Response(JSON.stringify({ error: '世界设定书不存在' }), { status: 404, headers });
    }

    // 全局状态
    const stateMatch = pathname.match(/^\/api\/projects\/(.+)\/state$/);
    if (stateMatch) {
      const pm = new ProjectManager(stateMatch[1]);
      const statePath = join(pm.projectDir, 'state.json');
      if (existsSync(statePath)) {
        return new Response(readFileSync(statePath, 'utf-8'), { headers });
      }
      return new Response(JSON.stringify({}), { headers });
    }

    // outline 大纲
    const outlineMatch = pathname.match(/^\/api\/projects\/(.+)\/outline$/);
    if (outlineMatch) {
      const pm = new ProjectManager(outlineMatch[1]);
      if (existsSync(pm.outlinePath)) {
        return new Response(readFileSync(pm.outlinePath, 'utf-8'), { headers });
      }
      return new Response(JSON.stringify({ error: '大纲不存在' }), { status: 404, headers });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
