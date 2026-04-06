import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AioOmaRuntime, AIO_BACKEND_ID } from './aio-backend.js'
import type { AcpRuntimeEnsureInput, AcpRuntimeTurnInput, AcpRuntimeHandle } from './aio-backend.js'
import type { AioSandboxManager } from '../sandbox/aio-manager.js'
import type { OmaInstaller, OmaInstallResult } from '../sandbox/oma-installer.js'
import type { AioShellResult } from '../sandbox/aio-manager.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockSandbox(overrides: Partial<Record<string, unknown>> = {}): AioSandboxManager {
  return {
    baseUrl: 'http://localhost:8330',
    mcpUrl: 'http://localhost:8330/mcp',
    isHealthy: true,
    checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
    start: vi.fn().mockResolvedValue(true),
    stop: vi.fn(),
    shellExec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'result', stderr: '' }),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    ...overrides,
  } as unknown as AioSandboxManager
}

function createMockInstaller(overrides: Partial<Record<string, unknown>> = {}): OmaInstaller {
  return {
    installPath: '/workspace/open-multi-agent',
    isInstalled: vi.fn().mockResolvedValue(true),
    install: vi.fn().mockResolvedValue({ installed: true, alreadyPresent: true } as OmaInstallResult),
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    ...overrides,
  } as unknown as OmaInstaller
}

function makeHandle(): AcpRuntimeHandle {
  return {
    sessionKey: 'test-session',
    backend: AIO_BACKEND_ID,
    runtimeSessionName: 'oma-test-session',
    cwd: '/workspace/open-multi-agent',
  }
}

async function collectEvents(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = []
  for await (const event of iterable) {
    events.push(event)
  }
  return events
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AioOmaRuntime', () => {
  describe('initial state', () => {
    it('starts unhealthy', () => {
      const runtime = new AioOmaRuntime(createMockSandbox(), createMockInstaller())
      expect(runtime.isHealthy()).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // probeAvailability
  // -------------------------------------------------------------------------

  describe('probeAvailability', () => {
    it('becomes healthy when sandbox and OMA are ready', async () => {
      const sandbox = createMockSandbox()
      const installer = createMockInstaller()
      const runtime = new AioOmaRuntime(sandbox, installer)

      await runtime.probeAvailability()
      expect(runtime.isHealthy()).toBe(true)
    })

    it('tries to start sandbox if unhealthy', async () => {
      const sandbox = createMockSandbox({
        isHealthy: false,
        checkHealth: vi.fn().mockResolvedValue({ healthy: false }),
        start: vi.fn().mockResolvedValue(true),
      })
      const installer = createMockInstaller()
      const runtime = new AioOmaRuntime(sandbox, installer)

      await runtime.probeAvailability()
      expect(sandbox.start).toHaveBeenCalled()
    })

    it('throws if sandbox start fails', async () => {
      const sandbox = createMockSandbox({
        isHealthy: false,
        checkHealth: vi.fn().mockResolvedValue({ healthy: false }),
        start: vi.fn().mockResolvedValue(false),
      })
      const installer = createMockInstaller()
      const runtime = new AioOmaRuntime(sandbox, installer)

      await expect(runtime.probeAvailability()).rejects.toThrow('auto-start failed')
      expect(runtime.isHealthy()).toBe(false)
    })

    it('throws if OMA install fails', async () => {
      const sandbox = createMockSandbox()
      const installer = createMockInstaller({
        install: vi.fn().mockResolvedValue({
          installed: false,
          alreadyPresent: false,
          error: 'clone error',
        }),
      })
      const runtime = new AioOmaRuntime(sandbox, installer)

      await expect(runtime.probeAvailability()).rejects.toThrow('install failed')
      expect(runtime.isHealthy()).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // ensureSession
  // -------------------------------------------------------------------------

  describe('ensureSession', () => {
    it('creates a new session handle', async () => {
      const runtime = new AioOmaRuntime(createMockSandbox(), createMockInstaller())
      const input: AcpRuntimeEnsureInput = {
        sessionKey: 'my-session',
        agent: 'open-multi-agent',
        mode: 'persistent',
      }

      const handle = await runtime.ensureSession(input)
      expect(handle.sessionKey).toBe('my-session')
      expect(handle.backend).toBe(AIO_BACKEND_ID)
      expect(handle.runtimeSessionName).toContain('oma-')
    })

    it('reuses existing session handle', async () => {
      const runtime = new AioOmaRuntime(createMockSandbox(), createMockInstaller())
      const input: AcpRuntimeEnsureInput = {
        sessionKey: 'reuse-me',
        agent: 'open-multi-agent',
        mode: 'persistent',
      }

      const h1 = await runtime.ensureSession(input)
      const h2 = await runtime.ensureSession(input)
      expect(h1).toBe(h2) // same object reference
    })

    it('uses custom cwd when provided', async () => {
      const runtime = new AioOmaRuntime(createMockSandbox(), createMockInstaller())
      const input: AcpRuntimeEnsureInput = {
        sessionKey: 'cwd-session',
        agent: 'open-multi-agent',
        mode: 'oneshot',
        cwd: '/custom/path',
      }

      const handle = await runtime.ensureSession(input)
      expect(handle.cwd).toBe('/custom/path')
    })
  })

  // -------------------------------------------------------------------------
  // runTurn
  // -------------------------------------------------------------------------

  describe('runTurn', () => {
    it('emits error when unhealthy', async () => {
      const runtime = new AioOmaRuntime(createMockSandbox(), createMockInstaller())
      // Not probed — still unhealthy

      const input: AcpRuntimeTurnInput = {
        handle: makeHandle(),
        text: 'Do something',
        mode: 'prompt',
        requestId: 'req-1',
      }

      const events = await collectEvents(runtime.runTurn(input))
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual(
        expect.objectContaining({ type: 'error', code: 'BACKEND_UNHEALTHY' }),
      )
    })

    it('runs task and streams output on success', async () => {
      const sandbox = createMockSandbox({
        shellExec: vi.fn().mockResolvedValue({
          exitCode: 0,
          stdout: 'Task completed successfully',
          stderr: '',
        }),
      })
      const installer = createMockInstaller()
      const runtime = new AioOmaRuntime(sandbox, installer)
      await runtime.probeAvailability()

      const input: AcpRuntimeTurnInput = {
        handle: makeHandle(),
        text: 'Build a REST API',
        mode: 'prompt',
        requestId: 'req-2',
      }

      const events = await collectEvents(runtime.runTurn(input))

      // Should have: status, status, text_delta, done
      const types = events.map((e: any) => e.type)
      expect(types).toContain('status')
      expect(types).toContain('text_delta')
      expect(types).toContain('done')

      const textEvent = events.find((e: any) => e.type === 'text_delta') as any
      expect(textEvent.text).toBe('Task completed successfully')
    })

    it('emits error on non-zero exit code', async () => {
      const sandbox = createMockSandbox({
        shellExec: vi.fn().mockResolvedValue({
          exitCode: 1,
          stdout: '',
          stderr: 'module not found',
        }),
      })
      const installer = createMockInstaller()
      const runtime = new AioOmaRuntime(sandbox, installer)
      await runtime.probeAvailability()

      const events = await collectEvents(
        runtime.runTurn({
          handle: makeHandle(),
          text: 'fail',
          mode: 'prompt',
          requestId: 'req-3',
        }),
      )

      const errorEvent = events.find((e: any) => e.type === 'error') as any
      expect(errorEvent).toBeDefined()
      expect(errorEvent.code).toBe('OMA_EXEC_ERROR')
      expect(errorEvent.message).toContain('module not found')
    })

    it('emits error on execution exception', async () => {
      const sandbox = createMockSandbox({
        shellExec: vi.fn().mockRejectedValue(new Error('network timeout')),
      })
      const installer = createMockInstaller()
      const runtime = new AioOmaRuntime(sandbox, installer)
      await runtime.probeAvailability()

      const events = await collectEvents(
        runtime.runTurn({
          handle: makeHandle(),
          text: 'something',
          mode: 'prompt',
          requestId: 'req-4',
        }),
      )

      const errorEvent = events.find((e: any) => e.type === 'error') as any
      expect(errorEvent).toBeDefined()
      expect(errorEvent.code).toBe('EXEC_FAILED')
      expect(errorEvent.message).toContain('network timeout')
    })

    it('escapes single quotes in message', async () => {
      const shellExec = vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
      })
      const sandbox = createMockSandbox({ shellExec })
      const installer = createMockInstaller()
      const runtime = new AioOmaRuntime(sandbox, installer)
      await runtime.probeAvailability()

      await collectEvents(
        runtime.runTurn({
          handle: makeHandle(),
          text: "it's a test",
          mode: 'prompt',
          requestId: 'req-5',
        }),
      )

      const cmd = shellExec.mock.calls[0][0] as string
      // Shell escaping replaces ' with '\'' — so the raw quote is gone
      expect(cmd).not.toContain("--task 'it's a test'")
      // The escaped form uses the '\'' idiom
      expect(cmd).toContain("it'\\''s a test")
    })
  })

  // -------------------------------------------------------------------------
  // cancel & close
  // -------------------------------------------------------------------------

  describe('cancel', () => {
    it('sends kill signal to sandbox', async () => {
      const sandbox = createMockSandbox()
      const runtime = new AioOmaRuntime(sandbox, createMockInstaller())

      await runtime.cancel({ handle: makeHandle(), reason: 'user cancelled' })

      expect(sandbox.shellExec).toHaveBeenCalledWith(
        expect.stringContaining('pkill'),
        expect.any(Number),
      )
    })
  })

  describe('close', () => {
    it('removes session from tracking', async () => {
      const runtime = new AioOmaRuntime(createMockSandbox(), createMockInstaller())
      const handle = await runtime.ensureSession({
        sessionKey: 'close-me',
        agent: 'oma',
        mode: 'persistent',
      })

      await runtime.close({ handle, reason: 'done' })

      // Ensure a new session is created (not reused) after close
      const newHandle = await runtime.ensureSession({
        sessionKey: 'close-me',
        agent: 'oma',
        mode: 'persistent',
      })
      expect(newHandle).not.toBe(handle) // different object
    })
  })
})
