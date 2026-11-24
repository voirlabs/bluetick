/** WhatsApp's customer service window: free-form messages are allowed for 24h after the customer's last message. */
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000

/** Milliseconds left in the window, or 0 when it is closed. */
export function serviceWindowLeft(
  lastInboundAt: Date | string | null | undefined,
  now = Date.now()
) {
  if (!lastInboundAt) return 0
  return Math.max(0, new Date(lastInboundAt).getTime() + SERVICE_WINDOW_MS - now)
}

export function isWithinServiceWindow(
  lastInboundAt: Date | string | null | undefined,
  now = Date.now()
) {
  return serviceWindowLeft(lastInboundAt, now) > 0
}
