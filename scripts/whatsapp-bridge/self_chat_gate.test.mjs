import { strict as assert } from 'node:assert';
import {
  bareWhatsAppUser,
  createIgnoreLogger,
  createReconnectController,
  isOwnSelfChat,
  isStaleInbound,
  shouldExitOnDisconnect,
} from './self_chat_gate.js';

{
  assert.equal(bareWhatsAppUser('919903556675:24@s.whatsapp.net'), '919903556675');
  assert.equal(bareWhatsAppUser('194527742668958:24@lid'), '194527742668958');
  console.log('  ✓ bareWhatsAppUser strips device suffix');
}

{
  const user = {
    id: '919903556675:24@s.whatsapp.net',
    lid: '194527742668958:24@lid',
  };
  assert.equal(isOwnSelfChat('919903556675@s.whatsapp.net', user), true);
  assert.equal(isOwnSelfChat('194527742668958@lid', user), true);
  assert.equal(isOwnSelfChat('144624584777752@lid', user), false);
  assert.equal(isOwnSelfChat('120363145437747576@g.us', user), false);
  assert.equal(isOwnSelfChat('status@broadcast', user), false);
  console.log('  ✓ isOwnSelfChat matches phone + LID, rejects groups/status');
}

{
  const lines = [];
  const logIgnored = createIgnoreLogger({ windowMs: 60_000, log: (s) => lines.push(s) });
  for (let i = 0; i < 5; i++) {
    logIgnored({
      reason: 'self_chat_mode_rejects_non_self',
      chatId: 'x@lid',
      senderId: 'x@lid',
    });
  }
  assert.equal(lines.length, 1, 'first reject logs immediately; rest are silenced');
  const first = JSON.parse(lines[0]);
  assert.equal(first.reason, 'self_chat_mode_rejects_non_self');
  assert.equal(first.suppressed, undefined);

  // windowMs=0 means every event logs (still resets count)
  const lines2 = [];
  const log2 = createIgnoreLogger({ windowMs: 0, log: (s) => lines2.push(s) });
  log2({ reason: 'x', chatId: 'a' });
  log2({ reason: 'x', chatId: 'a' });
  assert.equal(lines2.length, 2);
  console.log('  ✓ ignore logger rate-limits after the first line');
}

{
  const ctl = createReconnectController({
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10_000,
    restartDelayMs: 500,
  });
  assert.deepEqual(ctl.nextDelay(428), { giveUp: false, attempt: 1, delayMs: 1000 });
  assert.deepEqual(ctl.nextDelay(428), { giveUp: false, attempt: 2, delayMs: 2000 });
  assert.deepEqual(ctl.nextDelay(515), { giveUp: false, attempt: 3, delayMs: 500 });
  assert.equal(ctl.nextDelay(428).giveUp, true);
  ctl.reset();
  assert.equal(ctl.nextDelay(428).attempt, 1);
  console.log('  ✓ reconnect controller backs off and gives up');
}

{
  assert.equal(isStaleInbound({ messageTimestamp: Math.floor(Date.now() / 1000) - 10 }, 60_000), false);
  assert.equal(isStaleInbound({ messageTimestamp: Math.floor(Date.now() / 1000) - 600 }, 60_000), true);
  assert.equal(isStaleInbound({ messageTimestamp: Date.now() - 10_000 }, 60_000), false);
  console.log('  ✓ isStaleInbound handles sec and ms timestamps');
}

{
  assert.equal(shouldExitOnDisconnect(401, { loggedOut: 401 }), true);
  assert.equal(shouldExitOnDisconnect(428, { loggedOut: 401 }), false);
  console.log('  ✓ shouldExitOnDisconnect only exits on auth loss');
}

console.log('self_chat_gate.test.mjs: all passed');
