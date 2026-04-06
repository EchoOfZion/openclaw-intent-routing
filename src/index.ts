/**
 * @fileoverview OpenClaw plugin entry point for intent-based routing.
 *
 * This plugin:
 * 1. Registers an ACP backend that routes to open-multi-agent in AIO sandbox
 * 2. Uses `before_agent_reply` hook to classify messages and apply routing
 * 3. Uses `before_prompt_build` hook to inject routing context into agent prompt
 * 4. Manages the AIO sandbox lifecycle (auto-start, health check)
 *
 * The plugin follows OpenClaw's plugin architecture:
 * - `openclaw.plugin.json` for manifest/config schema
 * - `register()` for hook and service registration
 * - `skills/` directory for SKILL.md agent instructions
 */

import { AioSandboxManager, DEFAULT_AIO_CONFIG } from './sandbox/aio-manager.js'
import type { AioSandboxConfig } from './sandbox/aio-manager.js'
import { OmaInstaller, DEFAULT_OMA_CONFIG } from './sandbox/oma-installer.js'
import type { OmaConfig } from './sandbox/oma-installer.js'
import { AioOmaRuntime, AIO_BACKEND_ID } from './backend/aio-backend.js'
import { classifyIntent, DEFAULT_INTENT_RULES } from './routing/intent-classifier.js'
import type { IntentRule, IntentClassification } from './routing/intent-classifier.js'

// ---------------------------------------------------------------------------
// Plugin config types
// ---------------------------------------------------------------------------

export interface IntentRoutingPluginConfig {
  enabled: boolean
  aioSandbox: Partial<AioSandboxConfig>
  openMultiAgent: Partial<OmaConfig>
  routing: {
    complexAgentId: string
    simpleModelOverride: string
    customRules?: IntentRule[]
  }
}

const DEFAULT_PLUGIN_CONFIG: IntentRoutingPluginConfig = {
  enabled: true,
  aioSandbox: {},
  openMultiAgent: {},
  routing: {
    complexAgentId: 'open-multi-agent',
    simpleModelOverride: 'claude-3-5-haiku-20241022',
  },
}

// ---------------------------------------------------------------------------
// Plugin API types (subset of OpenClawPluginApi)
// ---------------------------------------------------------------------------
// These match the OpenClaw plugin API but are defined locally to keep
// the plugin self-contained. At runtime, the actual types come from
// the OpenClaw host.

interface PluginLogger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
  debug(msg: string): void
}

interface PluginServiceContext {
  config: Record<string, unknown>
  workspaceDir?: string
  logger: PluginLogger
}

interface PluginService {
  id: string
  start(ctx: PluginServiceContext): Promise<void>
  stop?(ctx: PluginServiceContext): Promise<void>
}

interface PluginApi {
  id: string
  name: string
  pluginConfig?: Record<string, unknown>
  logger: PluginLogger
  registerService(service: PluginService): void
  on(hookName: string, handler: (...args: any[]) => any, opts?: { priority?: number }): void
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

function createIntentRoutingService(rawConfig: unknown): PluginService {
  let sandbox: AioSandboxManager | null = null
  let installer: OmaInstaller | null = null
  let runtime: AioOmaRuntime | null = null
  let pluginConfig: IntentRoutingPluginConfig = DEFAULT_PLUGIN_CONFIG

  return {
    id: 'intent-routing-service',

    async start(ctx: PluginServiceContext): Promise<void> {
      // Resolve config
      pluginConfig = resolveConfig(rawConfig)

      if (!pluginConfig.enabled) {
        ctx.logger.info('intent-routing plugin disabled by config')
        return
      }

      // Initialize sandbox manager
      sandbox = new AioSandboxManager(pluginConfig.aioSandbox)
      installer = new OmaInstaller(sandbox, pluginConfig.openMultiAgent)
      runtime = new AioOmaRuntime(sandbox, installer)

      ctx.logger.info(`intent-routing: AIO backend "${AIO_BACKEND_ID}" initialized`)

      // Background probe — don't block plugin startup
      void (async () => {
        try {
          await runtime!.probeAvailability()
          ctx.logger.info('intent-routing: AIO sandbox + open-multi-agent ready')
        } catch (err) {
          ctx.logger.warn(
            `intent-routing: backend probe failed: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      })()
    },

    async stop(ctx: PluginServiceContext): Promise<void> {
      runtime = null
      installer = null
      if (sandbox) {
        // Don't auto-stop sandbox on plugin shutdown — user may want it running
        sandbox = null
      }
      ctx.logger.info('intent-routing: service stopped')
    },
  }
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function resolveConfig(raw: unknown): IntentRoutingPluginConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_PLUGIN_CONFIG

  const cfg = raw as Record<string, unknown>
  return {
    enabled: typeof cfg.enabled === 'boolean' ? cfg.enabled : DEFAULT_PLUGIN_CONFIG.enabled,
    aioSandbox: (cfg.aioSandbox as Partial<AioSandboxConfig>) ?? {},
    openMultiAgent: (cfg.openMultiAgent as Partial<OmaConfig>) ?? {},
    routing: {
      complexAgentId:
        typeof (cfg.routing as Record<string, unknown>)?.complexAgentId === 'string'
          ? (cfg.routing as Record<string, unknown>).complexAgentId as string
          : DEFAULT_PLUGIN_CONFIG.routing.complexAgentId,
      simpleModelOverride:
        typeof (cfg.routing as Record<string, unknown>)?.simpleModelOverride === 'string'
          ? (cfg.routing as Record<string, unknown>).simpleModelOverride as string
          : DEFAULT_PLUGIN_CONFIG.routing.simpleModelOverride,
      customRules: (cfg.routing as Record<string, unknown>)?.customRules as IntentRule[] | undefined,
    },
  }
}

// ---------------------------------------------------------------------------
// Hook: before_prompt_build — inject routing context
// ---------------------------------------------------------------------------

function createPromptBuildHook(rawConfig: unknown) {
  const config = resolveConfig(rawConfig)

  return async () => {
    if (!config.enabled) return {}

    return {
      prependSystemContext: [
        '## Intent-Based Routing Active',
        '',
        'This agent has intent-based routing enabled. Messages are automatically',
        'classified by complexity:',
        '- **Simple** messages (greetings, short questions) use a fast model',
        '- **Complex** messages (multi-step tasks, coordination, parallel work)',
        '  are routed to open-multi-agent in AIO sandbox for multi-agent execution',
        '',
        'The routing is transparent — the user does not need to do anything special.',
      ].join('\n'),
    }
  }
}

// ---------------------------------------------------------------------------
// Hook: before_agent_reply — classify and potentially intercept
// ---------------------------------------------------------------------------

function createBeforeReplyHook(rawConfig: unknown) {
  const config = resolveConfig(rawConfig)

  return async (event: Record<string, unknown>) => {
    if (!config.enabled) return {}

    const message = typeof event.text === 'string' ? event.text : ''
    if (!message) return {}

    // Classify the message
    const rules = config.routing.customRules ?? DEFAULT_INTENT_RULES
    const classification = classifyIntent(message, rules)

    // For simple messages — suggest model override
    if (classification.category === 'simple' && config.routing.simpleModelOverride) {
      return {
        modelOverride: config.routing.simpleModelOverride,
        metadata: {
          intentRouting: {
            category: classification.category,
            confidence: classification.confidence,
            matchedRule: classification.matchedRule,
          },
        },
      }
    }

    // Complex messages are handled by the SKILL.md instructions which
    // tell the agent to use the AIO sandbox backend for multi-agent work.
    // We add metadata so the skill/agent can see the classification.
    if (classification.category === 'complex') {
      return {
        metadata: {
          intentRouting: {
            category: classification.category,
            confidence: classification.confidence,
            matchedRule: classification.matchedRule,
            suggestedBackend: AIO_BACKEND_ID,
          },
        },
      }
    }

    return {}
  }
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

const plugin = {
  id: 'intent-routing',
  name: 'Intent Routing',
  description:
    'Classifies message complexity and routes complex tasks to open-multi-agent in AIO sandbox.',

  register(api: PluginApi) {
    // Register the AIO backend service
    api.registerService(createIntentRoutingService(api.pluginConfig))

    // Register prompt context hook
    api.on('before_prompt_build', createPromptBuildHook(api.pluginConfig), { priority: 50 })

    // Register message classification hook
    api.on('before_agent_reply', createBeforeReplyHook(api.pluginConfig), { priority: 10 })
  },
}

export default plugin

// ---------------------------------------------------------------------------
// Re-exports for external use
// ---------------------------------------------------------------------------

export { classifyIntent, DEFAULT_INTENT_RULES } from './routing/intent-classifier.js'
export type { IntentRule, IntentMatcher, IntentClassification, IntentCategory } from './routing/intent-classifier.js'
export { AioSandboxManager, DEFAULT_AIO_CONFIG } from './sandbox/aio-manager.js'
export type { AioSandboxConfig, AioHealthStatus, AioShellResult } from './sandbox/aio-manager.js'
export { OmaInstaller, DEFAULT_OMA_CONFIG } from './sandbox/oma-installer.js'
export type { OmaConfig, OmaInstallResult } from './sandbox/oma-installer.js'
export { AioOmaRuntime, AIO_BACKEND_ID } from './backend/aio-backend.js'
