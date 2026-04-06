# OpenClaw Intent Routing

**Stop using one brain for every task.**

---

## The Problem

The OpenClaw ecosystem already has a wealth of harnesses — Claude Code, Codex, Aider, open-multi-agent, ACPX… each excelling at different things.

But OpenClaw currently operates as **single-thread + single-harness path**: every message takes the same route, goes to the same harness, processed by the same model.

This leads to three direct consequences:

| Scenario | What happens | What should happen |
|----------|-------------|-------------------|
| User says "Hello" | Opus processes it, seconds of latency, heavy token cost | Haiku responds instantly, near-zero cost |
| User says "Translate this" | Full harness pipeline | Fast model returns directly |
| User says "Design the schema, then build the API, then write tests" | Single agent, serial execution, limited quality | Multi-agent parallel collaboration |

**Simple tasks are over-processed** — wasting tokens. **Complex tasks are under-served** — quality suffers. **Multiple harnesses sit idle** — capabilities wasted.

The root cause: **no dispatch layer.**

---

## What This Plugin Does

It adds a dispatch layer to OpenClaw. It solves two things:

### 1. One-Click Multi-Harness Integration

Different harnesses have different runtime requirements — some need Node.js, some depend on Docker, some communicate via MCP. Manually setting up the integration (pulling images, configuring ports, installing dependencies, registering backends) is a high barrier.

This plugin has built-in environment management:

```
Install plugin → Enable → On first complex task, auto-completes:

  Docker image pull → Container start → Health check →
  open-multi-agent clone → Dependency install → Build →
  ACP Backend registration → Ready
```

- **Docker container self-management** — Auto-pulls AIO sandbox image, starts container, maps ports, continuous health monitoring
- **open-multi-agent self-deployment** — Auto-clones repo, detects package manager, installs dependencies, builds
- **ACP Backend self-registration** — Registers as a standard ACP runtime backend, seamless integration with existing system

No manual image pulls. No port configuration. No startup scripts.

### 2. Automatic Routing by Task Complexity

Once the environment is ready, before each message reaches a harness, the plugin uses pure local rules (**zero LLM calls, zero latency, zero extra tokens**) to classify and route:

```
User message → Intent classification (local < 1ms) → Routing decision
                                                      ├─ Simple → Fast model (Haiku)
                                                      ├─ Complex → AIO sandbox / Multi-agent
                                                      └─ Default → Original binding route (unchanged)
```

---

## Classification Rules

16 built-in rules covering English and Chinese, evaluated by priority:

**Complex task signals (priority 10):**

| Rule | Example matches |
|------|----------------|
| Sequential execution | "First do X, then do Y" |
| Numbered steps | "Step 1: ..." / "Phase 1: ..." |
| Stage planning | "Phase 1: design" / "Stage 2: implement" |
| Numbered lists | "1. Do X\n2. Do Y" |
| Collaboration language | "collaborate" / "coordinate" / "work together" |
| Parallel execution | "in parallel" / "concurrently" / "at the same time" |
| Multiple deliverables | "build X and then implement Y" |
| Chinese sequence markers | "first...then...finally..." patterns |

**Long message rule (priority 15):** Over 500 characters

**Simple task rule (priority 20):** Under 200 characters with no complexity signals

The rule engine supports four matcher types: `regex`, `keyword`, `length`, `negation` — freely composable and extensible.

---

## Install

```bash
git clone https://github.com/EchoOfZion/openclaw-intent-routing.git
cd openclaw-intent-routing
npm install
npm run build
npm test
```

---

## Configuration

Add to `~/.openclaw/config.json5`:

```json5
{
  intentRouting: {
    enabled: true,

    // Routing rules
    routes: {
      "complex": {
        agentId: "orchestrator",
        executionMode: "acp",
        acpBackend: "aio-oma"
      },
      "simple": {
        modelOverride: "claude-3-5-haiku-20241022"
      }
    },

    // AIO sandbox (optional, defaults shown)
    aioSandbox: {
      baseUrl: "http://localhost:8330",
      autoStart: true,
      containerName: "openclaw-aio-sandbox"
    },

    // open-multi-agent (optional)
    openMultiAgent: {
      repoUrl: "https://github.com/JackChen-me/open-multi-agent.git",
      branch: "main"
    }
  }
}
```

To disable: set `enabled: false`. Zero side effects.

---

## Architecture

```
┌───────────────┐
│  User Message  │
└───────┬───────┘
        │
        ▼
┌────────────────────────────┐
│  Intent Classifier (local)  │  ← Zero LLM calls
│  16 built-in + custom rules │
└───────┬────────────────────┘
        │
        ├─ simple ──→ Model override (Haiku) ──→ Fast response
        │
        ├─ complex ─→ AIO Sandbox ──→ open-multi-agent ──→ Multi-agent collaboration
        │                 │
        │                 ├─ Docker auto-management
        │                 ├─ OMA auto-deployment
        │                 └─ ACP Backend registration
        │
        └─ default ──→ Original binding route (unchanged)
```

**Modules:**

| Module | Responsibility |
|--------|---------------|
| `intent-classifier` | Message classification engine, pure sync, no side effects |
| `intent-router` | Classification → routing decision mapping |
| `aio-manager` | AIO sandbox Docker lifecycle management |
| `oma-installer` | open-multi-agent auto-install and build |
| `aio-backend` | ACP runtime backend implementation |
| `index` | Plugin entry point, hook registration |

---

## Project Structure

```
├── openclaw.plugin.json          # Plugin manifest + config schema
├── package.json
├── tsconfig.json
├── skills/
│   └── intent-router/
│       └── SKILL.md              # Agent instructions
└── src/
    ├── index.ts                  # Plugin entry
    ├── index.test.ts
    ├── integration-test.ts       # End-to-end integration tests
    ├── routing/
    │   ├── intent-classifier.ts  # Classification engine (16 rules)
    │   ├── intent-classifier.test.ts
    │   ├── intent-router.ts      # Route mapping
    │   └── intent-router.test.ts
    ├── sandbox/
    │   ├── aio-manager.ts        # AIO sandbox management
    │   ├── aio-manager.test.ts
    │   ├── oma-installer.ts      # OMA auto-installer
    │   └── oma-installer.test.ts
    └── backend/
        ├── aio-backend.ts        # ACP runtime backend
        └── aio-backend.test.ts
```

---

## Testing

```bash
# Unit tests (146)
npm test

# Integration tests (requires running AIO sandbox)
npx tsx src/integration-test.ts [baseUrl]
```

---

## Custom Rules

Add custom classification rules via config:

```json5
{
  intentRouting: {
    enabled: true,
    routing: {
      customRules: [
        {
          id: "custom:deploy",
          category: "complex",
          priority: 5,
          matchers: [
            { type: "keyword", keywords: ["deploy", "rollback", "migration"] }
          ]
        }
      ]
    }
  }
}
```

Rules are evaluated by `priority` (ascending). First rule where all matchers pass wins.

---

## Key Features

- **Zero LLM calls** — Classification is entirely local, no token cost, no added latency
- **Lightweight** — < 2500 lines of code (including tests), no runtime dependencies
- **Low intrusion** — Plugin-based, does not modify OpenClaw core, disable to revert
- **One-click ready** — Docker + OMA environment fully auto-provisioned
- **Fully configurable** — Rules, routes, models all customizable
- **Well tested** — 146 unit tests + 9 integration tests, verified on real AIO sandbox

---

## Compatibility

- OpenClaw pluginApi >= 2026.3.24-beta.2
- Node.js >= 22
- Docker (required for AIO sandbox)

---

---

# OpenClaw Intent Routing

**让你的 Agent 不再用同一个脑子做所有事**

---

## 问题

OpenClaw 生态已经有了大量优秀的 Harness —— Claude Code、Codex、Aider、open-multi-agent、ACPX…… 它们擅长不同的事情。

但 OpenClaw 当前是 **单线程 + 单 Harness 路径**：所有消息走同一条路由，发给同一个 Harness，用同一个模型处理。

这带来三个直接后果：

| 场景 | 发生了什么 | 本该怎样 |
|------|-----------|---------|
| 用户说 "你好" | Opus 处理，数秒响应，消耗大量 token | Haiku 毫秒级返回，几乎零成本 |
| 用户说 "翻译这段话" | 完整 Harness 流程 | 快速模型直接完成 |
| 用户说 "先设计 schema，再写 API，最后写测试" | 单 Agent 串行处理，质量受限 | 多 Agent 并行协作，各司其职 |

**简单任务被过度处理** —— 浪费 token。**复杂任务处理能力不足** —— 质量打折。**多个 Harness 无法协同** —— 能力被闲置。

本质问题：**没有调度层。**

---

## 这个插件做什么

给 OpenClaw 加一个调度层。解决两件事：

### 1. 多 Harness 一键接入

不同的 Harness 运行环境各异 —— 有的需要 Node.js，有的依赖 Docker，有的走 MCP 协议。手动搭建接入流程（拉镜像、配端口、装依赖、注册 backend）门槛很高。

本插件内置了完整的环境管理：

```
安装插件 → 启用 → 首次遇到复杂任务时自动完成：

  Docker 镜像拉取 → 容器启动 → 健康检查 →
  open-multi-agent 克隆 → 依赖安装 → 构建 →
  ACP Backend 注册 → 就绪
```

- **Docker 容器自管理** —— 自动拉取 AIO 沙箱镜像、启动、端口映射、持续健康监控
- **open-multi-agent 自部署** —— 自动克隆、检测包管理器、安装依赖、构建
- **ACP Backend 自注册** —— 注册为标准 ACP 运行时后端，与现有体系无缝集成

你不需要手动拉镜像，不需要配端口，不需要写启动脚本。

### 2. 按任务复杂度自动路由

环境就绪后，每条消息到达 Harness 之前，插件用纯本地规则（**零 LLM 调用、零延迟、零额外 token**）自动判断并路由：

```
用户消息 → 意图分类（本地 < 1ms）→ 路由决策
                                     ├─ 简单 → 快速模型（Haiku）
                                     ├─ 复杂 → AIO 沙箱 / 多 Agent 协作
                                     └─ 常规 → 原有 binding 路由不变
```

---

## 分类规则

内置 16 条规则，覆盖中英文，按优先级评估：

**复杂任务信号（优先级 10）：**

| 规则 | 匹配示例 |
|------|---------|
| 顺序执行 | "先做 X，再做 Y" / "First..., then..." |
| 编号步骤 | "Step 1: ..." / "第一步：..." |
| 阶段规划 | "Phase 1: 设计" / "Stage 2: 实现" |
| 编号列表 | "1. 做 X\n2. 做 Y" |
| 协作语言 | "collaborate" / "coordinate" / "work together" |
| 并行执行 | "in parallel" / "concurrently" / "同时进行" |
| 多交付物 | "build X and then implement Y" |
| 中文序列标记 | "首先……然后……最后……" |

**长消息规则（优先级 15）：** 超过 500 字符

**简单任务规则（优先级 20）：** 低于 200 字符且不含复杂信号

规则引擎支持四种匹配器：`regex`、`keyword`、`length`、`negation`，可自由组合和扩展。

---

## 安装

```bash
git clone https://github.com/EchoOfZion/openclaw-intent-routing.git
cd openclaw-intent-routing
npm install
npm run build
npm test
```

---

## 配置

在 `~/.openclaw/config.json5` 中添加：

```json5
{
  intentRouting: {
    enabled: true,

    // 路由规则
    routes: {
      "complex": {
        agentId: "orchestrator",
        executionMode: "acp",
        acpBackend: "aio-oma"
      },
      "simple": {
        modelOverride: "claude-3-5-haiku-20241022"
      }
    },

    // AIO 沙箱（可选，以下均为默认值）
    aioSandbox: {
      baseUrl: "http://localhost:8330",
      autoStart: true,
      containerName: "openclaw-aio-sandbox"
    },

    // open-multi-agent（可选）
    openMultiAgent: {
      repoUrl: "https://github.com/JackChen-me/open-multi-agent.git",
      branch: "main"
    }
  }
}
```

关闭插件只需 `enabled: false`，零副作用。

---

## 架构

```
┌─────────────┐
│  用户消息    │
└──────┬──────┘
       │
       ▼
┌──────────────────────────┐
│  意图分类器（本地规则）     │  ← 零 LLM 调用
│  16 条内置规则 + 自定义     │
└──────┬───────────────────┘
       │
       ├─ simple ──→ 模型覆盖（Haiku）──→ 快速返回
       │
       ├─ complex ─→ AIO 沙箱 ──→ open-multi-agent ──→ 多 Agent 协作
       │                │
       │                ├─ Docker 自动管理
       │                ├─ OMA 自动部署
       │                └─ ACP Backend 注册
       │
       └─ default ──→ 原有 binding 路由（不变）
```

**模块组成：**

| 模块 | 职责 |
|------|------|
| `intent-classifier` | 消息分类引擎，纯同步，无副作用 |
| `intent-router` | 分类结果 → 路由决策映射 |
| `aio-manager` | AIO 沙箱 Docker 生命周期管理 |
| `oma-installer` | open-multi-agent 自动安装构建 |
| `aio-backend` | ACP 运行时后端实现 |
| `index` | 插件入口，钩子注册 |

---

## 项目结构

```
├── openclaw.plugin.json          # 插件清单 + 配置 schema
├── package.json
├── tsconfig.json
├── skills/
│   └── intent-router/
│       └── SKILL.md              # Agent 指令（路由行为描述）
└── src/
    ├── index.ts                  # 插件入口
    ├── index.test.ts
    ├── integration-test.ts       # 端到端集成测试
    ├── routing/
    │   ├── intent-classifier.ts  # 分类引擎（16 条规则）
    │   ├── intent-classifier.test.ts
    │   ├── intent-router.ts      # 路由映射
    │   └── intent-router.test.ts
    ├── sandbox/
    │   ├── aio-manager.ts        # AIO 沙箱管理
    │   ├── aio-manager.test.ts
    │   ├── oma-installer.ts      # OMA 自动安装
    │   └── oma-installer.test.ts
    └── backend/
        ├── aio-backend.ts        # ACP 运行时后端
        └── aio-backend.test.ts
```

---

## 测试

```bash
# 单元测试（146 个）
npm test

# 集成测试（需要运行中的 AIO 沙箱）
npx tsx src/integration-test.ts [baseUrl]
```

---

## 自定义规则

可以通过配置添加自定义分类规则：

```json5
{
  intentRouting: {
    enabled: true,
    routing: {
      customRules: [
        {
          id: "custom:deploy",
          category: "complex",
          priority: 5,
          matchers: [
            { type: "keyword", keywords: ["deploy", "rollback", "migration"] }
          ]
        }
      ]
    }
  }
}
```

规则按 `priority` 升序评估，第一个所有 matcher 都通过的规则胜出。

---

## 特性总结

- **零 LLM 调用** —— 分类完全本地完成，不消耗 token，不增加延迟
- **轻量** —— < 2500 行代码（含测试），无运行时依赖
- **低侵入** —— Plugin 形式接入，不修改 OpenClaw 核心，关闭即恢复
- **一键就绪** —— Docker + OMA 环境全自动搭建
- **完全可配** —— 规则、路由、模型全部可自定义
- **充分验证** —— 146 单元测试 + 9 集成测试，真实 AIO 沙箱通过

---

## 兼容性

- OpenClaw pluginApi >= 2026.3.24-beta.2
- Node.js >= 22
- Docker（AIO 沙箱需要）

---

## License

MIT
