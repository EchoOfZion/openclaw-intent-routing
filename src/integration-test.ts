/**
 * @fileoverview End-to-end integration test.
 *
 * Runs against a live AIO sandbox at the configured URL.
 * Usage: npx tsx src/integration-test.ts [baseUrl]
 */

import { AioSandboxManager } from './sandbox/aio-manager.js'
import { OmaInstaller } from './sandbox/oma-installer.js'
import { AioOmaRuntime } from './backend/aio-backend.js'
import { classifyIntent, DEFAULT_INTENT_RULES } from './routing/intent-classifier.js'

const baseUrl = process.argv[2] || 'http://localhost:8330'
const OMA_PATH = '/home/gem/open-multi-agent'

let passed = 0
let failed = 0

function ok(name: string) {
  passed++
  console.log(`  ✓ ${name}`)
}

function fail(name: string, err: unknown) {
  failed++
  console.log(`  ✗ ${name}: ${err instanceof Error ? err.message : String(err)}`)
}

async function main() {
  console.log(`\n Integration Test — AIO Sandbox at ${baseUrl}\n`)

  // -----------------------------------------------------------------------
  // 1. Sandbox health
  // -----------------------------------------------------------------------
  console.log('1. Sandbox health check')
  const sandbox = new AioSandboxManager({ baseUrl })
  try {
    const health = await sandbox.checkHealth()
    if (health.healthy) ok(`sandbox healthy (version: ${health.version})`)
    else fail('sandbox health', health.error)
  } catch (e) {
    fail('sandbox health', e)
  }

  // -----------------------------------------------------------------------
  // 2. Shell execution
  // -----------------------------------------------------------------------
  console.log('\n2. Shell execution')
  try {
    const result = await sandbox.shellExec('echo "hello from AIO" && node --version')
    if (result.exitCode === 0 && result.stdout.includes('hello from AIO')) {
      ok(`shell exec: exitCode=${result.exitCode}, output includes "hello from AIO"`)
    } else {
      fail('shell exec', `exitCode=${result.exitCode}, stdout=${result.stdout}`)
    }
  } catch (e) {
    fail('shell exec', e)
  }

  // -----------------------------------------------------------------------
  // 3. OMA installer check
  // -----------------------------------------------------------------------
  console.log('\n3. OMA installation check')
  const installer = new OmaInstaller(sandbox, { installPath: OMA_PATH })
  try {
    const installed = await installer.isInstalled()
    if (installed) ok('OMA is installed')
    else fail('OMA installed check', 'node_modules not found')
  } catch (e) {
    fail('OMA installed check', e)
  }

  // -----------------------------------------------------------------------
  // 4. OMA build check
  // -----------------------------------------------------------------------
  console.log('\n4. OMA build check')
  try {
    const result = await installer.exec('ls dist/index.js')
    if (result.exitCode === 0) ok('OMA dist/index.js exists')
    else fail('OMA build check', 'dist/index.js not found')
  } catch (e) {
    fail('OMA build check', e)
  }

  // -----------------------------------------------------------------------
  // 5. Intent classifier
  // -----------------------------------------------------------------------
  console.log('\n5. Intent classifier (local)')
  try {
    const simple = classifyIntent('Hello', DEFAULT_INTENT_RULES)
    if (simple.category === 'simple') ok(`"Hello" → ${simple.category} (rule: ${simple.matchedRule})`)
    else fail('classify simple', `expected "simple", got "${simple.category}"`)

    const complex = classifyIntent(
      'First design the schema, then implement the API endpoints',
      DEFAULT_INTENT_RULES,
    )
    if (complex.category === 'complex') ok(`complex msg → ${complex.category} (rule: ${complex.matchedRule})`)
    else fail('classify complex', `expected "complex", got "${complex.category}"`)
  } catch (e) {
    fail('intent classifier', e)
  }

  // -----------------------------------------------------------------------
  // 6. AIO OMA Runtime probe
  // -----------------------------------------------------------------------
  console.log('\n6. AIO OMA Runtime probe')
  const runtime = new AioOmaRuntime(sandbox, installer)
  try {
    await runtime.probeAvailability()
    if (runtime.isHealthy()) ok('runtime probe succeeded, backend healthy')
    else fail('runtime probe', 'not healthy after probe')
  } catch (e) {
    fail('runtime probe', e)
  }

  // -----------------------------------------------------------------------
  // 7. Session lifecycle
  // -----------------------------------------------------------------------
  console.log('\n7. Session lifecycle')
  try {
    const handle = await runtime.ensureSession({
      sessionKey: 'integration-test',
      agent: 'open-multi-agent',
      mode: 'oneshot',
    })
    ok(`session created: ${handle.runtimeSessionName}`)

    await runtime.close({ handle, reason: 'test done' })
    ok('session closed')
  } catch (e) {
    fail('session lifecycle', e)
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`  ${passed} passed, ${failed} failed`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
