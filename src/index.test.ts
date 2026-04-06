import { describe, it, expect } from 'vitest'
import plugin from './index.js'

// ---------------------------------------------------------------------------
// Plugin entry point tests
// ---------------------------------------------------------------------------

describe('plugin entry', () => {
  it('exports plugin with correct id', () => {
    expect(plugin.id).toBe('intent-routing')
  })

  it('exports plugin with name and description', () => {
    expect(plugin.name).toBe('Intent Routing')
    expect(plugin.description).toBeDefined()
    expect(plugin.description.length).toBeGreaterThan(10)
  })

  it('has a register function', () => {
    expect(typeof plugin.register).toBe('function')
  })

  it('register calls registerService and on hooks', () => {
    const calls: Array<{ method: string; args: unknown[] }> = []
    const mockApi = {
      id: 'intent-routing',
      name: 'Intent Routing',
      pluginConfig: { enabled: true },
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      registerService(service: unknown) {
        calls.push({ method: 'registerService', args: [service] })
      },
      on(hookName: string, handler: unknown, opts: unknown) {
        calls.push({ method: 'on', args: [hookName, handler, opts] })
      },
    }

    plugin.register(mockApi as any)

    // Should register a service
    const serviceCall = calls.find((c) => c.method === 'registerService')
    expect(serviceCall).toBeDefined()
    const service = serviceCall!.args[0] as { id: string }
    expect(service.id).toBe('intent-routing-service')

    // Should register before_prompt_build hook
    const promptHook = calls.find(
      (c) => c.method === 'on' && c.args[0] === 'before_prompt_build',
    )
    expect(promptHook).toBeDefined()

    // Should register before_agent_reply hook
    const replyHook = calls.find(
      (c) => c.method === 'on' && c.args[0] === 'before_agent_reply',
    )
    expect(replyHook).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

describe('re-exports', () => {
  it('exports classifyIntent from routing', async () => {
    const mod = await import('./index.js')
    expect(typeof mod.classifyIntent).toBe('function')
  })

  it('exports DEFAULT_INTENT_RULES', async () => {
    const mod = await import('./index.js')
    expect(Array.isArray(mod.DEFAULT_INTENT_RULES)).toBe(true)
    expect(mod.DEFAULT_INTENT_RULES.length).toBeGreaterThan(0)
  })

  it('exports AioSandboxManager class', async () => {
    const mod = await import('./index.js')
    expect(typeof mod.AioSandboxManager).toBe('function')
  })

  it('exports OmaInstaller class', async () => {
    const mod = await import('./index.js')
    expect(typeof mod.OmaInstaller).toBe('function')
  })

  it('exports AioOmaRuntime class', async () => {
    const mod = await import('./index.js')
    expect(typeof mod.AioOmaRuntime).toBe('function')
  })

  it('exports AIO_BACKEND_ID constant', async () => {
    const mod = await import('./index.js')
    expect(mod.AIO_BACKEND_ID).toBe('aio-oma')
  })
})
