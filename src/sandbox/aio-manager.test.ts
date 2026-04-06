import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AioSandboxManager, DEFAULT_AIO_CONFIG } from './aio-manager.js'
import type { AioSandboxConfig, DockerStatus } from './aio-manager.js'

// ---------------------------------------------------------------------------
// Mock fetch globally for sandbox API tests
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
})

// ---------------------------------------------------------------------------
// Constructor & defaults
// ---------------------------------------------------------------------------

describe('AioSandboxManager', () => {
  describe('constructor', () => {
    it('uses default config when none provided', () => {
      const mgr = new AioSandboxManager()
      expect(mgr.baseUrl).toBe(DEFAULT_AIO_CONFIG.baseUrl)
      expect(mgr.mcpUrl).toBe(`${DEFAULT_AIO_CONFIG.baseUrl}/mcp`)
    })

    it('merges partial config with defaults', () => {
      const mgr = new AioSandboxManager({ baseUrl: 'http://custom:9999' })
      expect(mgr.baseUrl).toBe('http://custom:9999')
      expect(mgr.mcpUrl).toBe('http://custom:9999/mcp')
    })
  })

  describe('initial state', () => {
    it('starts unhealthy', () => {
      const mgr = new AioSandboxManager()
      expect(mgr.isHealthy).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------

  describe('checkHealth', () => {
    it('returns healthy when API responds 200', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { version: '1.2.3' } }),
      })

      const mgr = new AioSandboxManager()
      const status = await mgr.checkHealth()

      expect(status.healthy).toBe(true)
      expect(status.version).toBe('1.2.3')
      expect(mgr.isHealthy).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        `${DEFAULT_AIO_CONFIG.baseUrl}/v1/sandbox`,
        expect.objectContaining({ method: 'GET' }),
      )
    })

    it('returns unhealthy on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      })

      const mgr = new AioSandboxManager()
      const status = await mgr.checkHealth()

      expect(status.healthy).toBe(false)
      expect(status.error).toBe('HTTP 503')
      expect(mgr.isHealthy).toBe(false)
    })

    it('returns unhealthy on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      const mgr = new AioSandboxManager()
      const status = await mgr.checkHealth()

      expect(status.healthy).toBe(false)
      expect(status.error).toBe('ECONNREFUSED')
      expect(mgr.isHealthy).toBe(false)
    })

    it('handles malformed JSON in health response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token')
        },
      })

      const mgr = new AioSandboxManager()
      const status = await mgr.checkHealth()

      // Malformed JSON → cannot confirm success → unhealthy
      expect(status.healthy).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Shell execution
  // -------------------------------------------------------------------------

  describe('shellExec', () => {
    it('sends command to shell API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { exit_code: 0, output: 'hello' },
        }),
      })

      const mgr = new AioSandboxManager()
      const result = await mgr.shellExec('echo hello')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('hello')
      expect(mockFetch).toHaveBeenCalledWith(
        `${DEFAULT_AIO_CONFIG.baseUrl}/v1/shell/exec`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

      const mgr = new AioSandboxManager()
      await expect(mgr.shellExec('bad command')).rejects.toThrow('HTTP 500')
    })
  })

  // -------------------------------------------------------------------------
  // File operations
  // -------------------------------------------------------------------------

  describe('readFile', () => {
    it('reads file via REST API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { content: 'file content here' } }),
      })

      const mgr = new AioSandboxManager()
      const content = await mgr.readFile('/workspace/test.txt')

      expect(content).toBe('file content here')
      expect(mockFetch).toHaveBeenCalledWith(
        `${DEFAULT_AIO_CONFIG.baseUrl}/v1/file/read`,
        expect.objectContaining({ method: 'POST' }),
      )
    })

    it('throws on read failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })

      const mgr = new AioSandboxManager()
      await expect(mgr.readFile('/nonexistent')).rejects.toThrow('HTTP 404')
    })
  })

  describe('writeFile', () => {
    it('writes file via REST API', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true })

      const mgr = new AioSandboxManager()
      await mgr.writeFile('/workspace/out.txt', 'data')

      expect(mockFetch).toHaveBeenCalledWith(
        `${DEFAULT_AIO_CONFIG.baseUrl}/v1/file/write`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ path: '/workspace/out.txt', content: 'data' }),
        }),
      )
    })

    it('throws on write failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 })

      const mgr = new AioSandboxManager()
      await expect(mgr.writeFile('/readonly/file', 'data')).rejects.toThrow('HTTP 403')
    })
  })

  // -------------------------------------------------------------------------
  // Stop
  // -------------------------------------------------------------------------

  describe('stop', () => {
    it('marks manager as unhealthy after stop', async () => {
      // First make it healthy
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { version: '1.0' } }),
      })
      const mgr = new AioSandboxManager({ autoStart: false })
      await mgr.checkHealth()
      expect(mgr.isHealthy).toBe(true)

      // Stop uses execHost (Docker command) which we can't mock directly,
      // but stop() catches errors from it gracefully
      // The key assertion is that isHealthy becomes false
      await mgr.stop().catch(() => {})
      expect(mgr.isHealthy).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // isLocalSandbox
  // -------------------------------------------------------------------------

  describe('isLocalSandbox', () => {
    it('returns true for localhost', () => {
      const mgr = new AioSandboxManager({ baseUrl: 'http://localhost:8330' })
      expect(mgr.isLocalSandbox).toBe(true)
    })

    it('returns true for 127.0.0.1', () => {
      const mgr = new AioSandboxManager({ baseUrl: 'http://127.0.0.1:8330' })
      expect(mgr.isLocalSandbox).toBe(true)
    })

    it('returns false for remote host', () => {
      const mgr = new AioSandboxManager({ baseUrl: 'http://47.79.85.40:8330' })
      expect(mgr.isLocalSandbox).toBe(false)
    })

    it('returns false for hostname', () => {
      const mgr = new AioSandboxManager({ baseUrl: 'http://my-server.example.com:8330' })
      expect(mgr.isLocalSandbox).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Docker detection
  // -------------------------------------------------------------------------

  describe('checkDocker', () => {
    it('returns available when docker info succeeds', async () => {
      const mgr = new AioSandboxManager()
      // checkDocker calls execHostWithOutput('docker', ['info']) internally.
      // We test by mocking the private method via prototype.
      const spy = vi.spyOn(mgr as any, 'execHostWithOutput').mockResolvedValueOnce('Docker version 24.0.0')

      const status = await mgr.checkDocker()
      expect(status.available).toBe(true)
      expect(status.error).toBeUndefined()
      expect(spy).toHaveBeenCalledWith('docker', ['info'])
    })

    it('detects Docker not installed (ENOENT)', async () => {
      const mgr = new AioSandboxManager()
      vi.spyOn(mgr as any, 'execHostWithOutput').mockRejectedValueOnce(
        new Error('spawn docker ENOENT'),
      )

      const status = await mgr.checkDocker()
      expect(status.available).toBe(false)
      expect(status.error).toContain('Docker is not installed')
      expect(status.error).toContain('https://docs.docker.com/get-docker/')
      expect(status.error).toContain('remote AIO sandbox')
    })

    it('detects Docker daemon not running', async () => {
      const mgr = new AioSandboxManager()
      vi.spyOn(mgr as any, 'execHostWithOutput').mockRejectedValueOnce(
        new Error('Cannot connect to the Docker daemon. Is the docker daemon running?'),
      )

      const status = await mgr.checkDocker()
      expect(status.available).toBe(false)
      expect(status.error).toContain('daemon is not running')
      expect(status.error).toContain('sudo systemctl start docker')
      expect(status.error).toContain('remote AIO sandbox')
    })

    it('handles unknown Docker errors', async () => {
      const mgr = new AioSandboxManager()
      vi.spyOn(mgr as any, 'execHostWithOutput').mockRejectedValueOnce(
        new Error('permission denied'),
      )

      const status = await mgr.checkDocker()
      expect(status.available).toBe(false)
      expect(status.error).toContain('permission denied')
      expect(status.error).toContain('remote AIO sandbox')
    })

    it('caches successful Docker check', async () => {
      const mgr = new AioSandboxManager()
      const spy = vi.spyOn(mgr as any, 'execHostWithOutput').mockResolvedValue('ok')

      await mgr.checkDocker()
      await mgr.checkDocker()

      // Only called once due to caching
      expect(spy).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // start() with Docker detection
  // -------------------------------------------------------------------------

  describe('start() Docker detection', () => {
    it('skips Docker check for remote sandbox', async () => {
      const mgr = new AioSandboxManager({
        baseUrl: 'http://47.79.85.40:8330',
        autoStart: true,
      })

      // Health check fails (sandbox not running)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      })

      // start() should NOT call checkDocker for remote host,
      // it goes straight to docker start (which will fail, but that's fine)
      const dockerSpy = vi.spyOn(mgr as any, 'execHostWithOutput')
      const execSpy = vi.spyOn(mgr as any, 'execHost').mockRejectedValue(new Error('fail'))

      await expect(mgr.start()).rejects.toThrow()
      expect(dockerSpy).not.toHaveBeenCalled()
    })

    it('throws with install guidance when Docker not found on local', async () => {
      const mgr = new AioSandboxManager({
        baseUrl: 'http://localhost:8330',
        autoStart: true,
      })

      // Health check fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      })

      // Docker not installed
      vi.spyOn(mgr as any, 'execHostWithOutput').mockRejectedValueOnce(
        new Error('spawn docker ENOENT'),
      )

      await expect(mgr.start()).rejects.toThrow('Docker is not installed')
    })

    it('throws with daemon guidance when Docker daemon not running', async () => {
      const mgr = new AioSandboxManager({
        baseUrl: 'http://localhost:8330',
        autoStart: true,
      })

      // Health check fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      })

      // Docker daemon not running
      vi.spyOn(mgr as any, 'execHostWithOutput').mockRejectedValueOnce(
        new Error('Cannot connect to the Docker daemon. Is the docker daemon running?'),
      )

      await expect(mgr.start()).rejects.toThrow('daemon is not running')
    })
  })
})
