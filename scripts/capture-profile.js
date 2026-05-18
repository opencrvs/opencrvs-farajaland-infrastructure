#!/usr/bin/env node
'use strict'

// Captures a V8 CPU profile from a running Node.js process via the inspector
// protocol. Send SIGUSR1 to the target process and port-forward port 9229
// before starting this script.
//
// Env:
//   INSPECT_PORT  inspector port (default 9229)
//   PROFILE_OUT   output file path (default profile.cpuprofile)
//
// Stop gracefully with SIGTERM or SIGINT — writes the profile before exiting.

const { writeFileSync } = require('fs')

const PORT = process.env.INSPECT_PORT ?? '9229'
const OUT = process.env.PROFILE_OUT ?? 'profile.cpuprofile'
const RETRIES = 10
const RETRY_MS = 1000

let msgId = 0
let ws
let stopId
let profiling = false

function send(method, params = {}) {
  ws.send(JSON.stringify({ id: ++msgId, method, params }))
}

async function getWsUrl() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  if (!res.ok) throw new Error(`/json returned ${res.status}`)
  const targets = await res.json()
  if (!targets.length) throw new Error('No inspector targets')
  return targets[0].webSocketDebuggerUrl
}

async function connectWithRetry() {
  for (let i = 0; i < RETRIES; i++) {
    try {
      return await getWsUrl()
    } catch (e) {
      if (i === RETRIES - 1) throw new Error(`Inspector not ready after ${RETRIES} attempts: ${e.message}`)
      await new Promise(r => setTimeout(r, RETRY_MS))
    }
  }
}

async function main() {
  const url = await connectWithRetry()
  console.log(`[profiler] connected to ${url}`)

  ws = new WebSocket(url)

  ws.onopen = () => {
    send('Profiler.enable')
    send('Profiler.start')
    profiling = true
    console.log('[profiler] recording — send SIGTERM to stop and write profile')
  }

  ws.onerror = (e) => {
    console.error('[profiler] WebSocket error:', e.message)
    process.exit(1)
  }

  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data)
    if (msg.id === stopId && msg.result?.profile) {
      writeFileSync(OUT, JSON.stringify(msg.result.profile))
      console.log(`[profiler] written → ${OUT}`)
      process.exit(0)
    }
  }
}

function stop() {
  if (profiling && ws?.readyState === WebSocket.OPEN) {
    console.log('[profiler] stopping...')
    stopId = ++msgId
    ws.send(JSON.stringify({ id: stopId, method: 'Profiler.stop' }))
  } else {
    process.exit(0)
  }
}

process.on('SIGTERM', stop)
process.on('SIGINT', stop)

main().catch((e) => {
  console.error('[profiler]', e.message)
  process.exit(1)
})
