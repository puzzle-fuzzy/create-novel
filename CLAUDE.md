# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-driven long-form novel generator targeting ~2 million Chinese characters. Uses OpenAI-compatible LLM APIs (DeepSeek, Qwen, GLM, etc.) to generate world settings, outlines, and chapter content with an agent-based architecture that includes quality control and hierarchical memory.

## Commands

```bash
bun install          # Install dependencies
bun run init         # Interactive project initialization (world-building setup)
bun run plan         # Generate world bible + arc structure + volume outlines
bun run write        # Write chapters sequentially (resumes from last checkpoint)
bun run compile      # Compile finished novel to TXT + stats report
bun run start        # Full pipeline: plan → write → compile
bun run status       # Show progress across all projects
bun run dashboard    # Start real-time monitoring UI (default port 3000)
```

All commands run via `bun run src/index.ts <command>`. No build step required (Bun executes TypeScript directly).

## Environment Configuration

Copy `.env.example` to `.env`. Key variables:
- `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` — primary LLM (default: GLM)
- `LLM_PLANNER_MODEL` — model for outline generation (higher quality)
- `LLM_WRITER_MODEL` — model for chapter writing
- `LLM_AGENT_MODEL` — model for agent decisions (unset = use default strategy, no LLM calls)
- `LLM_STREAM` — enable streaming output
- `CHAPTER_DELAY_MS` — delay between chapters (default 2000ms)

## Architecture

### Pipeline Flow

1. **init** → Interactive CLI creates `projects/<name>/config.yaml` with world settings, characters, and generation params
2. **plan** → Generates world bible → arc definitions → volume outlines (saved as `outline.json`)
3. **write** → For each chapter: Agent decision → context assembly → generate → code quality check → LLM review → (rewrite loop up to 5 attempts) → save → update state + summaries
4. **compile** → Concatenates chapter files into final TXT, optionally splits by volume, generates stats

### Core Modules

- **`src/index.ts`** — CLI entry point and command router
- **`src/config.ts`** — `ProjectManager` class (file I/O for all project data) + all TypeScript types (`NovelConfig`, `FullOutline`, `Progress`, `AgentDecision`, `WorldState`, etc.)
- **`src/llm.ts`** — OpenAI-compatible client wrapper with streaming and retry logic
- **`src/planner.ts`** — Generates world bible, arc structure (multi-arc for 200万字), and per-volume outlines with checkpoint resume
- **`src/writer.ts`** — Main writing loop: agent decision → context assembly → generate → quality check → LLM review → state/summary update. Supports resume from checkpoint
- **`src/compiler.ts`** — Assembles final novel from chapter files
- **`src/agent/controller.ts`** — Pre-write strategy decisions and post-write story health evaluation
- **`src/agent/prompts.ts`** — Agent prompt templates and JSON response parsers

### Hierarchical Memory System (`src/memory/`)

Three levels of summaries to maintain coherence across 540 chapters:
- **`summaries.ts`** — Per-chapter summaries (stored in `summaries.json`, last 10 injected into prompts)
- **`volume_summary.ts`** — Per-volume summaries (generated at volume end, stored in `summaries/volumes/`)
- **`arc_summary.ts`** — Per-arc summaries (generated at arc end, stored in `summaries/arcs/`)
- **`state.ts`** — Live `WorldState` tracking characters, foreshadows, timeline, and opening patterns
- **`context_assembler.ts`** — Assembles hierarchical context for chapter prompts (caps at 20000 chars)
- **`volume_state.ts`** — State snapshots at volume boundaries + pruning to prevent unbounded growth

### Quality Control (`src/quality/`)

- **`checker.ts`** — Zero-cost code-level quality checks (no LLM): word count, opening repetition (Jaccard similarity), cliché ending detection, first-character repetition, structure checks. Scores 0-100, pass threshold 70.
- **`src/prompts/review.ts`** — LLM-based deep review scoring 1-10 on plot completion, character consistency, context coherence, writing quality, and attractiveness. Pass threshold 7.0.

### Prompt Templates (`src/prompts/`)

- **`world.ts`** — World bible, arc structure, volume outline, and premise prompts
- **`chapter.ts`** — Chapter system/user prompts with world bible smart truncation (caps at 12000 chars, prioritizes character/foreshadow sections)
- **`state.ts`** — State extraction from chapter content
- **`review.ts`** — LLM review prompt and response parser

### Real-time Dashboard (`src/dashboard.ts`)

HTTP server (Bun.serve) on port 3000 + WebSocket on port 3001. Serves `dashboard/index.html` with REST API endpoints under `/api/`. Uses event bus (`src/events.ts`) to broadcast writing progress.

### Project Data Layout

```
projects/<name>/
  config.yaml              # World settings, characters, generation params
  world_bible.txt           # Generated world bible
  outline.json              # Full outline (volumes + chapters)
  progress.json             # Writing progress tracking
  state.json                # Live world state (characters, foreshadows, timeline)
  summaries.json            # Per-chapter summaries
  chapters/                 # vXX_cXXX.txt files
  output/                   # Compiled novel + stats
  summaries/volumes/        # Volume-level summaries
  summaries/arcs/           # Arc-level summaries
  state_snapshots/          # Per-volume state snapshots
  agent_decisions.json      # History of agent decisions
```

## Key Design Patterns

- **Checkpoint resume**: Both planning and writing skip completed work. Outline generates volume-by-volume and saves incrementally. Writing skips chapters that already have files.
- **Closed-loop quality**: Generate → code check → LLM review → rewrite with feedback (up to 5 attempts). Best-scoring version is kept even if threshold isn't met.
- **State pruning**: `WorldState` is pruned at volume boundaries (resolved foreshadows, old timeline events, character info capped) to prevent memory bloat over 540 chapters.
- **JSON repair**: Multiple `extractJSON`/`repairJSON` utilities handle truncated LLM output — strip code blocks, auto-close brackets, fix trailing commas.
- **Multi-model support**: Different models can be assigned to planning, writing, and agent decisions via env vars. All use the same OpenAI-compatible API.
