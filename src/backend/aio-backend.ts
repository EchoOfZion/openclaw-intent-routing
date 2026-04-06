/**
 * @fileoverview AIO sandbox ACP backend.
 *
 * Implements the {@link AcpRuntime} interface to route tasks to the
 * open-multi-agent harness running inside an AIO sandbox. Communication
 * happens via the AIO sandbox shell API — the backend executes
 * open-multi-agent CLI commands inside the container and streams
 * back events.
 *
 * This module uses type-only references to OpenClaw's ACP runtime types
 * to remain self-contained in the plugin package. The actual runtime
 * types are provided by the host at load time.
 */

import type { AioSandboxManager } from '../sandbox/aio-manager.js'
import type { OmaInstaller } from '../sandbox/oma-installer.js'

// ---------------------------------------------------------------------------
// ACP Runtime types (subset — matches openclaw/src/acp/runtime/types.ts)
// ---------------------------------------------------------------------------

/** ACP session handle. */
export interface AcpRuntimeHandle {
  sessionKey: string
  backend: string
  runtimeSessionName: string
  cwd?: string
}

/** Input for ensuring a session exists. */
export interface AcpRuntimeEnsureInput {
  sessionKey: string
  agent: string
  mode: 'persistent' | 'oneshot'
  resumeSessionId?: string
  cwd?: string
  env?: Record<string, string>
}

/** Input for running a turn. */
export interface AcpRuntimeTurnInput {
  handle: AcpRuntimeHandle
  text: string
  attachments?: Array<{ mediaType: string; data: string }>
  mode: 'prompt' | 'steer'
  requestId: string
  signal?: AbortSignal
}

/** Events emitted during a turn. */
export type AcpRuntimeEvent =
  | { type: 'text_delta'; text: string; stream?: 'output' | 'thought' }
  | { type: 'status'; text: string }
  | { type: 'tool_call'; text: string; status?: string }
  | { type: 'done'; stopReason?: string }
  | { type: 'error'; message: string; code?: string; retryable?: boolean }

/** ACP Runtime interface (core methods). */
export interface AcpRuntime {
  ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle>
  runTurn(input: AcpRuntimeTurnInput): AsyncIterable<AcpRuntimeEvent>
  cancel(input: { handle: AcpRuntimeHandle; reason?: string }): Promise<void>
  close(input: { handle: AcpRuntimeHandle; reason: string }): Promise<void>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AIO_BACKEND_ID = 'aio-oma'

// ---------------------------------------------------------------------------
// Backend implementation
// ---------------------------------------------------------------------------

export class AioOmaRuntime implements AcpRuntime {
  private readonly sandbox: AioSandboxManager
  private readonly installer: OmaInstaller
  private readonly sessions = new Map<string, AcpRuntimeHandle>()
  private _healthy = false

  constructor(sandbox: AioSandboxManager, installer: OmaInstaller) {
    this.sandbox = sandbox
    this.installer = installer
  }

  isHealthy(): boolean {
    return this._healthy && this.sandbox.isHealthy
  }

  /**
   * Probe availability: ensure sandbox is running and OMA is installed.
   */
  async probeAvailability(): Promise<void> {
    // 1. Check sandbox health
    const health = await this.sandbox.checkHealth()
    if (!health.healthy) {
      // Try to start sandbox
      const started = await this.sandbox.start()
      if (!started) {
        this._healthy = false
        throw new Error('AIO sandbox is not available and auto-start failed')
      }
    }

    // 2. Ensure OMA is installed
    const result = await this.installer.install()
    if (!result.installed) {
      this._healthy = false
      throw new Error(`open-multi-agent install failed: ${result.error}`)
    }

    this._healthy = true
  }

  // -----------------------------------------------------------------------
  // AcpRuntime interface
  // -----------------------------------------------------------------------

  async ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle> {
    const existing = this.sessions.get(input.sessionKey)
    if (existing) return existing

    const handle: AcpRuntimeHandle = {
      sessionKey: input.sessionKey,
      backend: AIO_BACKEND_ID,
      runtimeSessionName: `oma-${input.sessionKey.replace(/[^a-zA-Z0-9-]/g, '-')}`,
      cwd: input.cwd ?? this.installer.installPath,
    }

    this.sessions.set(input.sessionKey, handle)
    return handle
  }

  async *runTurn(input: AcpRuntimeTurnInput): AsyncIterable<AcpRuntimeEvent> {
    if (!this._healthy) {
      yield { type: 'error', message: 'AIO backend is not healthy', code: 'BACKEND_UNHEALTHY' }
      return
    }

    // Emit status
    yield { type: 'status', text: 'Routing to open-multi-agent in AIO sandbox...' }

    try {
      // Escape the message for shell command
      const escapedMessage = input.text.replace(/'/g, "'\\''")

      // Run the task via open-multi-agent inside the sandbox
      // OMA typically exposes a CLI or can be invoked via Node.js
      const command = [
        `cd "${this.installer.installPath}"`,
        `node index.js --task '${escapedMessage}'`,
      ].join(' && ')

      yield { type: 'status', text: 'Executing in AIO sandbox...' }

      const result = await this.sandbox.shellExec(command, 300_000)

      if (result.exitCode !== 0) {
        yield {
          type: 'error',
          message: `open-multi-agent exited with code ${result.exitCode}: ${result.stderr}`,
          code: 'OMA_EXEC_ERROR',
          retryable: true,
        }
        return
      }

      // Stream the output as text deltas
      if (result.stdout) {
        yield { type: 'text_delta', text: result.stdout, stream: 'output' }
      }

      yield { type: 'done', stopReason: 'end_turn' }
    } catch (err) {
      yield {
        type: 'error',
        message: `Execution failed: ${err instanceof Error ? err.message : String(err)}`,
        code: 'EXEC_FAILED',
        retryable: false,
      }
    }
  }

  async cancel(input: { handle: AcpRuntimeHandle; reason?: string }): Promise<void> {
    // Send SIGTERM to any running process in the sandbox
    // The sandbox shell API handles process management
    try {
      await this.sandbox.shellExec('pkill -f "node index.js --task" || true', 5_000)
    } catch {
      // Best-effort cancellation
    }
  }

  async close(input: { handle: AcpRuntimeHandle; reason: string }): Promise<void> {
    this.sessions.delete(input.handle.sessionKey)
  }
}
