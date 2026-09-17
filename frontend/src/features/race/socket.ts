// The room WebSocket (docs/race-protocol.md §3): auth first, then frames both ways.
// Reconnects on its own while the tab is open, because a dropped socket during a
// race keeps the player's slot on the server (§6) — reconnecting simply resumes.

import { getAccessToken, refreshAccessToken, roomSocketUrl } from '../../lib/api'
import type { ClientFrame, ServerFrame } from './protocol'

export interface RoomSocketHandlers {
  onFrame: (frame: ServerFrame) => void
  onConnected: (connected: boolean) => void
  /** Called when the server refused us for good (bad token, full room, ...). */
  onRejected: (reason: string) => void
}

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000]
// 4xxx close codes are protocol rejections (§3); the browser will not get a better answer by retrying.
const REJECTED = /^4(400|401|409)$/

export class RoomSocket {
  private readonly code: string
  private readonly handlers: RoomSocketHandlers
  private ws: WebSocket | null = null
  private attempts = 0
  private closedByUs = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(code: string, handlers: RoomSocketHandlers) {
    this.code = code
    this.handlers = handlers
  }

  connect(): void {
    this.closedByUs = false
    void this.open()
  }

  private async open(): Promise<void> {
    const token = getAccessToken() ?? (await refreshAccessToken())
    if (!token) {
      this.handlers.onRejected('unauthorized')
      return
    }
    const ws = new WebSocket(roomSocketUrl(this.code))
    this.ws = ws
    ws.onopen = () => {
      this.attempts = 0
      ws.send(JSON.stringify({ type: 'auth', token } satisfies ClientFrame))
      this.handlers.onConnected(true)
    }
    ws.onmessage = (event: MessageEvent<string>) => {
      this.handlers.onFrame(JSON.parse(event.data) as ServerFrame)
    }
    ws.onclose = (event: CloseEvent) => {
      this.handlers.onConnected(false)
      if (this.closedByUs) return
      if (REJECTED.test(String(event.code))) {
        this.handlers.onRejected(event.reason || String(event.code))
        return
      }
      const delay = RECONNECT_DELAYS_MS[Math.min(this.attempts, RECONNECT_DELAYS_MS.length - 1)]
      this.attempts += 1
      this.timer = setTimeout(() => void this.open(), delay)
    }
  }

  send(frame: ClientFrame): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame))
  }

  close(): void {
    this.closedByUs = true
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
    this.ws = null
  }
}
