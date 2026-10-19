import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const BACKEND_DIR = path.resolve(here, '../../backend')

function goBinary(): string {
  if (process.env.GO) return process.env.GO
  const candidates = ['C:\\Program Files\\Go\\bin\\go.exe', '/usr/local/go/bin/go', '/usr/bin/go']
  return candidates.find((c) => existsSync(c)) ?? 'go'
}

let built: string | undefined

/** Builds the Go server once per process and returns the binary path. */
export function buildServer(): string {
  if (built) return built
  const dir = path.join(os.tmpdir(), 'smh-build')
  mkdirSync(dir, { recursive: true })
  const out = path.join(dir, process.platform === 'win32' ? 'server.exe' : 'server')
  execFileSync(goBinary(), ['build', '-o', out, './cmd/server'], {
    cwd: BACKEND_DIR,
    stdio: 'pipe',
  })
  built = out
  return out
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

export interface RunningServer {
  url: string
  port: number
  dataDir: string
  logs: () => string
  stop(): Promise<void>
}

export async function startBlossom(opts: {
  dataDir: string
  port?: number
  env?: Record<string, string>
}): Promise<RunningServer> {
  const binary = buildServer()
  const port = opts.port ?? (await freePort())
  const url = `http://127.0.0.1:${port}`
  let log = ''
  const child: ChildProcess = spawn(binary, [], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: opts.dataDir,
      BASE_URL: url,
      RATE_LIMIT_PER_SECOND: '0',
      ...opts.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let exited = false
  child.once('exit', () => (exited = true))
  child.stdout?.on('data', (d) => (log += d))
  child.stderr?.on('data', (d) => (log += d))

  const deadline = Date.now() + 15_000
  for (;;) {
    try {
      const res = await fetch(`${url}/health`)
      if (res.ok) break
    } catch {
      /* not up yet */
    }
    if (child.exitCode !== null) throw new Error(`server exited early:\n${log}`)
    if (Date.now() > deadline) {
      child.kill()
      throw new Error(`server did not become healthy:\n${log}`)
    }
    await new Promise((r) => setTimeout(r, 50))
  }

  return {
    url,
    port,
    dataDir: opts.dataDir,
    logs: () => log,
    stop: () =>
      new Promise((resolve) => {
        if (exited) return resolve()
        child.once('exit', () => resolve())
        child.kill()
      }),
  }
}
