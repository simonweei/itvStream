import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { runDueUpdates } from '../lib/server.js';

class KV {
  values = new Map();
  async get(key) { return this.values.get(key) ?? null; }
  async put(key, value) { this.values.set(key, value); }
  async delete(key) { this.values.delete(key); }
  async list({ prefix }) { return { keys: [...this.values.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
}
const key = (prefix, id) => prefix + '_' + Buffer.from(id).toString('hex');
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
