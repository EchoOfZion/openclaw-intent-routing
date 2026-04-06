/**
 * @fileoverview open-multi-agent installer for AIO sandbox.
 *
 * Clones (or updates) open-multi-agent inside the AIO sandbox, installs
 * dependencies, and verifies the installation is functional.
 *
 * All operations execute inside the sandbox via the AIO shell API —
 * no host-side code execution.
 */

import type { AioSandboxManager, AioShellResult } from './aio-manager.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OmaConfig {
  readonly repoUrl: string
  readonly branch: string
  readonly installPath: string
}

export interface OmaInstallResult {
  readonly installed: boolean
  readonly alreadyPresent: boolean
  readonly error?: string
  readonly version?: string
}

export const DEFAULT_OMA_CONFIG: OmaConfig = {
  repoUrl: 'https://github.com/JackChen-me/open-multi-agent.git',
  branch: 'main',
  installPath: '/workspace/open-multi-agent',
}

// ---------------------------------------------------------------------------
// Installer
// ---------------------------------------------------------------------------

export class OmaInstaller {
  private readonly config: OmaConfig
  private readonly sandbox: AioSandboxManager

  constructor(sandbox: AioSandboxManager, config: Partial<OmaConfig> = {}) {
    this.config = { ...DEFAULT_OMA_CONFIG, ...config }
    this.sandbox = sandbox
  }

  get installPath(): string {
    return this.config.installPath
  }

  /**
   * Check if open-multi-agent is already installed and functional.
   */
  async isInstalled(): Promise<boolean> {
    try {
      const result = await this.sandbox.shellExec(
        `test -d "${this.config.installPath}/node_modules" && echo "ok"`,
        10_000,
      )
      return result.exitCode === 0 && result.stdout.trim() === 'ok'
    } catch {
      return false
    }
  }

  /**
   * Install or update open-multi-agent in the AIO sandbox.
   *
   * Steps:
   * 1. Check if already installed
   * 2. Clone repo (or pull if already cloned)
   * 3. Install Node.js dependencies
   * 4. Verify installation
   */
  async install(): Promise<OmaInstallResult> {
    // Check if already installed
    const alreadyPresent = await this.isInstalled()
    if (alreadyPresent) {
      // Pull latest and update deps
      try {
        await this.sandbox.shellExec(
          `cd "${this.config.installPath}" && git pull origin ${this.config.branch}`,
          30_000,
        )
        await this.installDependencies()
        return { installed: true, alreadyPresent: true }
      } catch (err) {
        return {
          installed: true,
          alreadyPresent: true,
          error: `Update failed (existing install still usable): ${errorMessage(err)}`,
        }
      }
    }

    // Clone repository
    try {
      await this.sandbox.shellExec(
        `git clone --branch ${this.config.branch} --depth 1 "${this.config.repoUrl}" "${this.config.installPath}"`,
        120_000,
      )
    } catch (err) {
      return {
        installed: false,
        alreadyPresent: false,
        error: `Git clone failed: ${errorMessage(err)}`,
      }
    }

    // Install dependencies
    try {
      await this.installDependencies()
    } catch (err) {
      return {
        installed: false,
        alreadyPresent: false,
        error: `Dependency install failed: ${errorMessage(err)}`,
      }
    }

    // Verify installation
    const verified = await this.isInstalled()
    if (!verified) {
      return {
        installed: false,
        alreadyPresent: false,
        error: 'Installation completed but verification failed',
      }
    }

    return { installed: true, alreadyPresent: false }
  }

  /**
   * Execute a command inside the open-multi-agent directory.
   */
  async exec(command: string, timeout = 120_000): Promise<AioShellResult> {
    return this.sandbox.shellExec(
      `cd "${this.config.installPath}" && ${command}`,
      timeout,
    )
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async installDependencies(): Promise<void> {
    // Try pnpm first (preferred), fall back to npm
    const pnpmCheck = await this.sandbox.shellExec('command -v pnpm', 5_000)
    const pm = pnpmCheck.exitCode === 0 ? 'pnpm' : 'npm'

    const result = await this.sandbox.shellExec(
      `cd "${this.config.installPath}" && ${pm} install`,
      180_000,
    )
    if (result.exitCode !== 0) {
      throw new Error(`${pm} install failed: ${result.stderr || result.stdout}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
