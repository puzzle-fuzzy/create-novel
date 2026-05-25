// 实时事件广播 — 连接 writer/planner 与 Dashboard

type EventHandler = (event: StatusEvent) => void;

export interface StatusEvent {
  type: 'phase_change' | 'chapter_start' | 'chapter_progress' | 'chapter_complete' | 'volume_complete' | 'arc_complete' | 'quality_check' | 'agent_decision' | 'error' | 'planning_progress' | 'complete';
  timestamp: string;
  data: Record<string, any>;
}

const listeners: Set<EventHandler> = new Set();
let eventHistory: StatusEvent[] = [];
const MAX_HISTORY = 500;

export function onStatusEvent(handler: EventHandler): () => void {
  listeners.add(handler);
  return () => { listeners.delete(handler); };
}

export function emitStatusEvent(type: StatusEvent['type'], data: Record<string, any> = {}): void {
  const event: StatusEvent = {
    type,
    timestamp: new Date().toISOString(),
    data,
  };
  eventHistory.push(event);
  if (eventHistory.length > MAX_HISTORY) {
    eventHistory = eventHistory.slice(-MAX_HISTORY);
  }
  for (const handler of listeners) {
    try { handler(event); } catch {}
  }
}

export function getEventHistory(): StatusEvent[] {
  return eventHistory;
}
