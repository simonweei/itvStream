import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { runDueUpdates } from '../lib/server.js';
import { readFile } from 'node:fs/promises';
import { newSession, readSession } from '../lib/auth.js';

class KV {
  values = new Map();
  async get(key) { return this.values.get(key) ?? null; }
  async put(key, value) { this.values.set(key, value); }
  async delete(key) { this.values.delete(key); }
  async list({ prefix }) { return { keys: [...this.values.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
}
const key = (prefix, id) => prefix + '_' + Buffer.from(id).toString('hex');

test('默认 Cron 每 10 分钟唤醒，未到期时全天只初始化扫描一次；会话过期立即失效且每天清理', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(config.triggers.crons, ['*/10 * * * *']);
  const kv = new KV(), start = 10 * 86400000, counts = { source_: 0, session_: 0 };
  const originalList = kv.list.bind(kv);
  kv.list = async options => { counts[options.prefix]++; return originalList(options); };
  const env = { SESSION_SECRET: 's'.repeat(64) };
  const { session, token } = await newSession(env, start);
  await kv.put(`session_${session.id}`, JSON.stringify(session));
  await kv.put('session_expired', JSON.stringify({ id: 'expired', expiresAt: start - 1 }));
  for (let tick = 0; tick < 144; tick++) {
    await runDueUpdates(kv, env, { now: start + tick * 10 * 60000, fetcher: () => assert.fail('无来源时不应拉取') });
  }
  assert.deepEqual(counts, { source_: 1, session_: 1 });
  assert.equal(await kv.get('session_expired'), null);
  assert.ok(await kv.get(`session_${session.id}`));
  assert.equal(await readSession(new Request('https://example.com/api/session', { headers: { Cookie: `live_session=${token}` } }), env, kv, session.expiresAt), null);
  await runDueUpdates(kv, env, { now: start + 86400000 });
  assert.deepEqual(counts, { source_: 2, session_: 2 });
  assert.equal(await kv.get(`session_${session.id}`), null);
});

test('调度进行中新增来源的修订标记不被旧扫描覆盖，下一轮重新计算计划', async () => {
  const kv = new KV(), now = 10 * 86400000;
  const source = { id: 'daily', enabled: true, intervalDays: 1, updatedAt: 1, url: 'https://example.com/daily' };
  await kv.put(key('source', 'daily'), JSON.stringify(source));
  const fetcher = async url => {
    if (url.endsWith('/daily')) {
      await kv.put(key('source', 'new'), JSON.stringify({ ...source, id: 'new', url: 'https://example.com/new' }));
      await kv.put('scheduler_revision', JSON.stringify({ value: 'changed-during-fetch' }));
    }
    return new Response('#EXTM3U\n#EXTINF:-1,A\nhttps://example.com/live\n');
  };
  assert.deepEqual((await runDueUpdates(kv, {}, { now, fetcher })).results.map(result => result.id), ['daily']);
  assert.deepEqual((await runDueUpdates(kv, {}, { now, fetcher })).results.map(result => result.id), ['new']);
});
test('内置后台按各源间隔执行，无 HTTP 调度地址或密钥；未到期和停用源不更新', async () => {
  const kv = new KV(), now = 10 * 86400000, attempted = now - 86400000;
  for (const [id, days, enabled] of [['daily', 1, true], ['weekly', 7, true], ['disabled', 1, false]]) {
    await kv.put(key('source', id), JSON.stringify({ id, enabled, intervalDays: days, updatedAt: 1, url: `https://example.com/${id}`, format: 'auto' }));
    await kv.put(key('status', id), JSON.stringify({ lastAttemptAt: attempted }));
  }
  const fetched = [];
  const result = await runDueUpdates(kv, {}, { now, fetcher: async url => {
    fetched.push(url); return new Response('#EXTM3U\n#EXTINF:-1,A\nhttps://example.com/live.m3u8\n');
  } });
  assert.deepEqual(fetched, ['https://example.com/daily']);
  assert.equal(result.results[0].ok, true);
  assert.equal(JSON.parse(await kv.get(key('status', 'daily'))).lastAttemptAt, now);
  assert.equal((await runDueUpdates(kv, {}, { now, fetcher: () => assert.fail('重复更新') })).results.length, 0);
});
test('同一个 Worker 提供 API 与静态资源，后台不依赖登录会话或 CRON_SECRET', async () => {
  const env = { LIVE_KV: new KV(), ADMIN_PASSWORD: 'test-password', SESSION_SECRET: 's'.repeat(64), ASSETS: { fetch: async () => new Response('asset') } };
  assert.equal((await worker.fetch(new Request('https://example.com/api/session'), env)).status, 401);
  assert.equal(await (await worker.fetch(new Request('https://example.com/admin/'), env)).text(), 'asset');
  let pending;
  await worker.scheduled({}, env, { waitUntil(promise) { pending = promise; } });
  await pending;
  assert.ok(JSON.parse(await env.LIVE_KV.get('scheduler_status')).lastRunAt);
});
