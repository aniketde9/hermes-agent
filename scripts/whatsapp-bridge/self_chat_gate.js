/**
 * Self-chat identity + reconnect / ignore helpers for the WhatsApp bridge.
 *
 * Baileys often delivers "Message yourself" notes typed on the phone as
 * fromMe=false sync copies. Self-chat mode must still accept those when the
 * chat JID is the linked account's own phone or LID — while rejecting
 * strangers/groups (#8389).
 */

export function bareWhatsAppUser(value) {
  return String(value || '').replace(/:.*@/, '@').replace(/@.*/, '');
}

export function isOwnSelfChat(chatId, user) {
  if (!chatId) return false;
  const id = String(chatId);
  if (id.endsWith('@g.us') || id.includes('status')) return false;
  const chatNumber = bareWhatsAppUser(id);
  if (!chatNumber) return false;
  const myNumber = bareWhatsAppUser(user?.id);
  const myLid = bareWhatsAppUser(user?.lid);
  return (!!myNumber && chatNumber === myNumber) || (!!myLid && chatNumber === myLid);
}

/** Rate-limit ignore JSON lines so history dumps do not flood bridge.log. */
export function createIgnoreLogger({ windowMs = 60_000, log = console.log } = {}) {
  const state = new Map();
  return function logIgnored({ reason, chatId, senderId } = {}) {
    const key = `${reason || ''}|${chatId || ''}`;
    const now = Date.now();
    const entry = state.get(key) || { count: 0, lastLog: 0 };
    entry.count += 1;
    const due = entry.lastLog === 0 || now - entry.lastLog >= windowMs;
    if (!due) {
      state.set(key, entry);
      return;
    }
    const suppressed = entry.lastLog === 0 ? 0 : Math.max(0, entry.count - 1);
    try {
      const payload = { event: 'ignored', reason, chatId, senderId };
      if (suppressed) payload.suppressed = suppressed;
      log(JSON.stringify(payload));
    } catch {}
    entry.count = 0;
    entry.lastLog = now;
    state.set(key, entry);
  };
}

/**
 * Bounded exponential backoff for connection.close reconnects.
 * Returns { giveUp, attempt, delayMs }.
 */
export function createReconnectController({
  maxAttempts = 20,
  baseDelayMs = 3000,
  maxDelayMs = 120_000,
  restartDelayMs = 1000,
} = {}) {
  let attempt = 0;
  return {
    reset() {
      attempt = 0;
    },
    nextDelay(reason) {
      attempt += 1;
      if (attempt > maxAttempts) {
        return { giveUp: true, attempt, delayMs: 0 };
      }
      if (reason === 515) {
        return { giveUp: false, attempt, delayMs: restartDelayMs };
      }
      const exp = Math.min(attempt - 1, 5);
      const delayMs = Math.min(baseDelayMs * (2 ** exp), maxDelayMs);
      return { giveUp: false, attempt, delayMs };
    },
    get attempt() {
      return attempt;
    },
  };
}

/** Drop ancient history dumps; live notes are almost always recent. */
export function isStaleInbound(msg, maxAgeMs = 5 * 60 * 1000) {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return false;
  const ts = Number(msg?.messageTimestamp || 0);
  if (!ts) return false;
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return Date.now() - ms > maxAgeMs;
}

/** 401 / loggedOut / device_removed — re-pair; do not spin forever. */
export function shouldExitOnDisconnect(reason, DisconnectReason) {
  if (reason === DisconnectReason?.loggedOut) return true;
  if (reason === 401) return true;
  return false;
}
