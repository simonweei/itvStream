import { handle, runDueUpdates } from '../lib/server.js';

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/') || path.startsWith('/sub/')) return handle({ request, env }, env.LIVE_KV);
    return env.ASSETS.fetch(request);
  },
  async scheduled(controller, env, context) {
    context.waitUntil(runDueUpdates(env.LIVE_KV, env).then(result => {
      const failed = result.results.filter(item => !item.ok).length;
      console.log(JSON.stringify({ event: 'source-update', processed: result.results.length, failed, remaining: result.remaining }));
      if (failed) throw new Error(`${failed} 个来源更新失败，请查看更新记录`);
    }));
  }
};
