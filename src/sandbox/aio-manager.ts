/**
 * @fileoverview AIO Sandbox lifecycle manager.
 *
 * Manages the AIO sandbox Docker container: health checks, auto-start,
 * and stop. Communicates with the AIO REST API at `/v1/`.
 *
 * @see https://github.com/agent-infra/aio
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AioSandboxConfig {
  readonly baseUrl: string
  readonly dockerImage: string
  readonly autoStart: boolean
  readonly containerName: string
  readonly ports: {
    readonly api: number
    readonly vnc: number
    readonly vscode: number
  }
}

export interface AioHealthStatus {
  readonly healthy: boolean
  readonly version?: string
  readonly error?: string
}

export interface AioShellResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export const DEFAULT_AIO_CONFIG: AioSandboxConfig = {
  baseUrl: 'http://localhost:8330',
  dockerImage: 'ghcr.io/agent-infra/sandbox:latest',
  autoStart: true,
  containerName: 'openclaw-aio-sandbox',
  ports: { api: 8330, vnc: 5900, vscode: 18080 },
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class AioSandboxManager {
  private readonly config: AioSandboxConfig
  private _healthy = false

  constructor(config: Partial<AioSandboxConfig> = {}) {
    this.config = { ...DEFAULT_AIO_CONFIG, ...config }
  }

  get baseUrl(): string {
    return this.config.baseUrl
  }

  get mcpUrl(): string {
    return `${this.config.baseUrl}/mcp`
  }

  get isHealthy(): boolean {
    return this._healthy
  }

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------

  /**
   * Probe the AIO sandbox health endpoint.
   * Updates internal health state and returns status.
   */
  async checkHealth(): Promise<AioHealthStatus> {
    try {
      const res = await fetch(`${this.config.baseUrl}/v1/sandbox`, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      })
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
        // AIO response: { success, data: { version, ... } } or { success, message, data }
        const success = body.success === true
        if (success) {
          const detail = body.data as Record<string, unknown> | undefined
          const version = typeof body.version === 'string'
            ? body.version
            : typeof detail?.version === 'string'
              ? detail.version
              : 'unknown'
          this._healthy = true
          return { healthy: true, version }
        }
      }
      this._healthy = false
      return { healthy: false, error: `HTTP ${res.status}` }
    } catch (err) {
      this._healthy = false
      return {
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // -------------------------------------------------------------------------
  // Container lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start the AIO sandbox Docker container.
   * Returns true if the container is running after this call.
   */
  async start(): Promise<boolean> {
    // Check if already running
    const health = await this.checkHealth()
    if (health.healthy) return true

    if (!this.config.autoStart) {
      return false
    }

    // Try to start existing stopped container first
    try {
      await this.execHost('docker', [
        'start',
        this.config.containerName,
      ])
      // Wait for container to be ready
      return await this.waitForReady(30_000)
    } catch {
      // Container doesn't exist, create it
    }

    // Create and start new container
    try {
      const { api, vnc, vscode } = this.config.ports
      await this.execHost('docker', [
        'run', '-d',
        '--name', this.config.containerName,
        '--security-opt', 'seccomp=unconfined',
        '--shm-size=2gb',
        '-p', `${api}:8080`,
        '-p', `${vnc}:5900`,
        '-p', `${vscode}:18080`,
        this.config.dockerImage,
      ])
      return await this.waitForReady(60_000)
    } catch (err) {
      this._healthy = false
      throw new Error(
        `Failed to start AIO sandbox: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * Stop the AIO sandbox Docker container.
   */
  async stop(): Promise<void> {
    try {
      await this.execHost('docker', ['stop', this.config.containerName])
    } catch {
      // Container may already be stopped
    }
    this._healthy = false
  }

  // -------------------------------------------------------------------------
  // Sandbox shell execution
  // -------------------------------------------------------------------------

  /**
   * Execute a shell command inside the AIO sandbox via REST API.
   */
  async shellExec(command: string, timeout = 60_000): Promise<AioShellResult> {
    const res = await fetch(`${this.config.baseUrl}/v1/shell/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, timeout }),
      signal: AbortSignal.timeout(timeout + 5_000),
    })

    if (!res.ok) {
      throw new Error(`AIO shell exec failed: HTTP ${res.status}`)
    }

    const body = (await res.json()) as Record<string, unknown>

    // AIO response format: { success, data: { exit_code, output, ... } }
    if (body.data && typeof body.data === 'object') {
      const d = body.data as Record<string, unknown>
      return {
        exitCode: typeof d.exit_code === 'number' ? d.exit_code : (d.exitCode as number ?? -1),
        stdout: typeof d.output === 'string' ? d.output : '',
        stderr: typeof d.stderr === 'string' ? d.stderr : '',
      }
    }

    // Fallback: direct format (e.g., in tests with mocked responses)
    return body as unknown as AioShellResult
  }

  // -------------------------------------------------------------------------
  // File operations via REST API
  // -------------------------------------------------------------------------

  /**
   * Read a file from the AIO sandbox.
   */
  async readFile(path: string): Promise<string> {
    const res = await fetch(`${this.config.baseUrl}/v1/file/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      throw new Error(`AIO file read failed: HTTP ${res.status}`)
    }
    const body = (await res.json()) as Record<string, unknown>
    if (body.data && typeof body.data === 'object') {
      const d = body.data as Record<string, unknown>
      return typeof d.content === 'string' ? d.content : JSON.stringify(d)
    }
    return typeof body.data === 'string' ? body.data : await res.text()
  }

  /**
   * Write a file to the AIO sandbox.
   */
  async writeFile(path: string, content: string): Promise<void> {
    const res = await fetch(`${this.config.baseUrl}/v1/file/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      throw new Error(`AIO file write failed: HTTP ${res.status}`)
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Wait for the sandbox to become healthy, polling every 2s.
   */
  private async waitForReady(timeoutMs: number): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const health = await this.checkHealth()
      if (health.healthy) return true
      await sleep(2_000)
    }
    return false
  }

  /**
   * Execute a command on the host machine.
   * Used for Docker management commands.
   */
  private execHost(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      import('node:child_process').then(({ execFile }) => {
        execFile(command, args, { timeout: 30_000 }, (error: Error | null) => {
          if (error) reject(error)
          else resolve()
        })
      }).catch(reject)
    })
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
