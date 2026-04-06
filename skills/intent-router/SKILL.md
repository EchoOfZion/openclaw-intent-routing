---
name: intent-router
description: Route messages by complexity — simple messages use a fast model, complex multi-step tasks are delegated to open-multi-agent running in AIO sandbox for parallel multi-agent execution. Automatically classifies via local heuristics (zero LLM calls).
user-invocable: false
---

# Intent-Based Routing

This skill automatically classifies incoming messages by complexity and routes them to the appropriate execution backend.

## Classification Categories

### Simple messages

Short, single-action requests that do not require multi-agent coordination:

- Greetings ("Hello", "Hi there")
- Simple questions ("What time is it?", "How do I X?")
- Single-step actions ("Translate this", "Summarize that")
- Messages under 200 characters with no complexity signals

**Routing**: Use fast model override (e.g., claude-3-5-haiku) for cost/latency savings.

### Complex messages

Multi-step tasks requiring coordination, sequencing, or parallel execution:

- Sequential patterns: "First do X, then do Y"
- Numbered steps: "Step 1: ..., Step 2: ..."
- Phase/stage markers: "Phase 1: design, Phase 2: implement"
- Coordination language: "collaborate", "coordinate", "work together"
- Parallel execution: "in parallel", "concurrently", "at the same time"
- Multiple deliverables: "build X and then implement Y"
- Very long messages (500+ characters)
- Chinese multi-step markers: first/then/finally patterns

**Routing**: Delegate to open-multi-agent in AIO sandbox via ACP backend.

## How to handle complex tasks

When the intent routing metadata indicates `category: "complex"`:

1. Use `sessions_spawn` with `runtime: "acp"` and the AIO backend
2. Set `agentId` to the configured complex task agent (default: `open-multi-agent`)
3. The AIO sandbox runs open-multi-agent which handles multi-agent orchestration internally
4. Stream results back to the user

### Example routing for a complex task

User says: "First design the database schema, then implement the API endpoints, and finally write tests for everything."

This matches the `complex:first-then` pattern. Route via:

```json
{
  "task": "First design the database schema, then implement the API endpoints, and finally write tests for everything.",
  "runtime": "acp",
  "agentId": "open-multi-agent",
  "thread": true,
  "mode": "session"
}
```

### Example routing for a simple task

User says: "Say hello"

This matches the `simple:short` pattern. Use the fast model override — no AIO sandbox needed.

## Complexity detection patterns

The classifier uses these regex/keyword patterns (evaluated in priority order):

| Pattern | Example triggers |
|---------|-----------------|
| first...then | "First design X, then implement Y" |
| step N | "Step 1: plan the architecture" |
| phase N | "Phase 1: requirements gathering" |
| stage N | "Stage 2: implementation" |
| numbered lists | "1. Do X\n2. Do Y" |
| collaborate/coordinate | "Collaborate on the API design" |
| work together | "Let's work together on this" |
| in parallel/concurrently | "Run tests in parallel" |
| multi-deliverable | "Build the frontend and then deploy" |
| Chinese markers | first/then/finally/step-by-step |
| 500+ chars | Long detailed specifications |

## Fallback behavior

- If the AIO sandbox is not available, fall back to default routing
- If classification is ambiguous (default category), use existing binding-based routing
- If open-multi-agent is not installed, the plugin will attempt auto-install on first use

## Do not

- Do not use intent routing for messages explicitly targeting a specific harness (use acp-router skill)
- Do not override the user's explicit agent choice
- Do not route to AIO sandbox when the sandbox is unhealthy
