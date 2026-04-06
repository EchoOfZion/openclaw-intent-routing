import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OmaInstaller, DEFAULT_OMA_CONFIG } from './oma-installer.js'
import type { AioSandboxManager, AioShellResult } from './aio-manager.js'

// ---------------------------------------------------------------------------
// Mock sandbox
// ---------------------------------------------------------------------------

function createMockSandbox(
  overrides: Partial<Record<keyof AioSandboxManager, unknown>> = {},
): AioSandboxManager {
  return {
    baseUrl: 'http://localhost:8330',
    mcpUrl: 'http://localhost:8330/mcp',
    isHealthy: true,
    checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
    start: vi.fn().mockResolvedValue(true),
    stop: vi.fn().mockResolvedValue(undefined),
    shellExec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AioSandboxManager
}

function shellResult(
  exitCode: number,
  stdout = '',
  stderr = '',
): AioShellResult {
  return { exitCode, stdout, stderr }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OmaInstaller', () => {
  describe('constructor', () => {
    it('uses default config', () => {
      const sandbox = createMockSandbox()
      const installer = new OmaInstaller(sandbox)
      expect(installer.installPath).toBe(DEFAULT_OMA_CONFIG.installPath)
    })

    it('merges custom config', () => {
      const sandbox = createMockSandbox()
      const installer = new OmaInstaller(sandbox, {
        installPath: '/custom/path',
      })
      expect(installer.installPath).toBe('/custom/path')
    })
  })

  // -------------------------------------------------------------------------
  // isInstalled
  // -------------------------------------------------------------------------

  describe('isInstalled', () => {
    it('returns true when node_modules exists', async () => {
      const sandbox = createMockSandbox({
        shellExec: vi.fn().mockResolvedValue(shellResult(0, 'ok')),
      })
      const installer = new OmaInstaller(sandbox)
      expect(await installer.isInstalled()).toBe(true)
    })

    it('returns false when node_modules missing', async () => {
      const sandbox = createMockSandbox({
        shellExec: vi.fn().mockResolvedValue(shellResult(1, '')),
      })
      const installer = new OmaInstaller(sandbox)
      expect(await installer.isInstalled()).toBe(false)
    })

    it('returns false on network error', async () => {
      const sandbox = createMockSandbox({
        shellExec: vi.fn().mockRejectedValue(new Error('timeout')),
      })
      const installer = new OmaInstaller(sandbox)
      expect(await installer.isInstalled()).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // install — fresh install
  // -------------------------------------------------------------------------

  describe('install (fresh)', () => {
    it('clones repo and installs deps', async () => {
      const shellExec = vi.fn()
        // isInstalled check (node_modules missing)
        .mockResolvedValueOnce(shellResult(1))
        // git clone
        .mockResolvedValueOnce(shellResult(0))
        // pnpm check (not found)
        .mockResolvedValueOnce(shellResult(1))
        // npm install
        .mockResolvedValueOnce(shellResult(0))
        // verify: isInstalled check (node_modules present)
        .mockResolvedValueOnce(shellResult(0, 'ok'))

      const sandbox = createMockSandbox({ shellExec })
      const installer = new OmaInstaller(sandbox)
      const result = await installer.install()

      expect(result.installed).toBe(true)
      expect(result.alreadyPresent).toBe(false)
      expect(result.error).toBeUndefined()

      // Verify git clone was called
      const cloneCall = shellExec.mock.calls[1][0] as string
      expect(cloneCall).toContain('git clone')
      expect(cloneCall).toContain(DEFAULT_OMA_CONFIG.repoUrl)
    })

    it('reports clone failure', async () => {
      const shellExec = vi.fn()
        .mockResolvedValueOnce(shellResult(1)) // isInstalled: no
        .mockRejectedValueOnce(new Error('git clone failed'))

      const sandbox = createMockSandbox({ shellExec })
      const installer = new OmaInstaller(sandbox)
      const result = await installer.install()

      expect(result.installed).toBe(false)
      expect(result.error).toContain('Git clone failed')
    })

    it('reports dependency install failure', async () => {
      const shellExec = vi.fn()
        .mockResolvedValueOnce(shellResult(1)) // isInstalled: no
        .mockResolvedValueOnce(shellResult(0)) // git clone: ok
        .mockResolvedValueOnce(shellResult(1)) // pnpm check: no
        .mockResolvedValueOnce(shellResult(1, '', 'ERR!')) // npm install: fail

      const sandbox = createMockSandbox({ shellExec })
      const installer = new OmaInstaller(sandbox)
      const result = await installer.install()

      expect(result.installed).toBe(false)
      expect(result.error).toContain('Dependency install failed')
    })

    it('reports verification failure', async () => {
      const shellExec = vi.fn()
        .mockResolvedValueOnce(shellResult(1)) // isInstalled: no
        .mockResolvedValueOnce(shellResult(0)) // git clone: ok
        .mockResolvedValueOnce(shellResult(0)) // pnpm check: yes
        .mockResolvedValueOnce(shellResult(0)) // pnpm install: ok
        .mockResolvedValueOnce(shellResult(1)) // verify: still no node_modules

      const sandbox = createMockSandbox({ shellExec })
      const installer = new OmaInstaller(sandbox)
      const result = await installer.install()

      expect(result.installed).toBe(false)
      expect(result.error).toContain('verification failed')
    })
  })

  // -------------------------------------------------------------------------
  // install — update existing
  // -------------------------------------------------------------------------

  describe('install (already present)', () => {
    it('pulls and updates when already installed', async () => {
      const shellExec = vi.fn()
        // isInstalled: yes
        .mockResolvedValueOnce(shellResult(0, 'ok'))
        // git pull
        .mockResolvedValueOnce(shellResult(0))
        // pnpm check
        .mockResolvedValueOnce(shellResult(0))
        // pnpm install
        .mockResolvedValueOnce(shellResult(0))

      const sandbox = createMockSandbox({ shellExec })
      const installer = new OmaInstaller(sandbox)
      const result = await installer.install()

      expect(result.installed).toBe(true)
      expect(result.alreadyPresent).toBe(true)
    })

    it('tolerates update failure on existing install', async () => {
      const shellExec = vi.fn()
        .mockResolvedValueOnce(shellResult(0, 'ok')) // isInstalled: yes
        .mockRejectedValueOnce(new Error('git pull failed')) // pull: fail

      const sandbox = createMockSandbox({ shellExec })
      const installer = new OmaInstaller(sandbox)
      const result = await installer.install()

      expect(result.installed).toBe(true)
      expect(result.alreadyPresent).toBe(true)
      expect(result.error).toContain('Update failed')
    })
  })

  // -------------------------------------------------------------------------
  // exec
  // -------------------------------------------------------------------------

  describe('exec', () => {
    it('runs command in OMA directory', async () => {
      const shellExec = vi.fn().mockResolvedValue(shellResult(0, 'output'))
      const sandbox = createMockSandbox({ shellExec })
      const installer = new OmaInstaller(sandbox)

      const result = await installer.exec('node index.js --help')

      expect(result.stdout).toBe('output')
      const cmd = shellExec.mock.calls[0][0] as string
      expect(cmd).toContain(`cd "${DEFAULT_OMA_CONFIG.installPath}"`)
      expect(cmd).toContain('node index.js --help')
    })
  })

  // -------------------------------------------------------------------------
  // pnpm vs npm
  // -------------------------------------------------------------------------

  describe('package manager selection', () => {
    it('uses pnpm when available', async () => {
      const shellExec = vi.fn()
        .mockResolvedValueOnce(shellResult(1)) // isInstalled: no
        .mockResolvedValueOnce(shellResult(0)) // git clone
        .mockResolvedValueOnce(shellResult(0)) // pnpm check: found!
        .mockResolvedValueOnce(shellResult(0)) // pnpm install
        .mockResolvedValueOnce(shellResult(0, 'ok')) // verify

      const sandbox = createMockSandbox({ shellExec })
      const installer = new OmaInstaller(sandbox)
      await installer.install()

      const installCmd = shellExec.mock.calls[3][0] as string
      expect(installCmd).toContain('pnpm install')
    })

    it('falls back to npm when pnpm not available', async () => {
      const shellExec = vi.fn()
        .mockResolvedValueOnce(shellResult(1)) // isInstalled: no
        .mockResolvedValueOnce(shellResult(0)) // git clone
        .mockResolvedValueOnce(shellResult(1)) // pnpm check: not found
        .mockResolvedValueOnce(shellResult(0)) // npm install
        .mockResolvedValueOnce(shellResult(0, 'ok')) // verify

      const sandbox = createMockSandbox({ shellExec })
      const installer = new OmaInstaller(sandbox)
      await installer.install()

      const installCmd = shellExec.mock.calls[3][0] as string
      expect(installCmd).toContain('npm install')
    })
  })
})
