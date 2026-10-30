import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionResponse } from '../lib/subscription-response.js';

const text = '#EXTM3U\n#EXTINF:-1 group-title="央视",中文频道\nhttps://example.com/live.m3u8\n';
const bytes = new TextEncoder().encode(text);
const request = (headers = {}, method = 'GET') => new Request('https://example.com/sub/test/playlist.m3u', { method, headers });

test('所有格式的 HEAD 长度按 UTF-8 字节计算，与 GET 一致；忽略 HEAD Range', async () => {
  for (const format of ['m3u', 'm3u8', 'txt', 'json']) {
    const get = subscriptionResponse(request(), text, format);
    const body = await get.arrayBuffer();
    const head = subscriptionResponse(request({ Range: 'bytes=0-7' }, 'HEAD'), text, format);
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal(head.headers.get('content-length'), String(body.byteLength));
    assert.deepEqual(Object.fromEntries(head.headers), Object.fromEntries(get.headers));
  }
  assert.equal(await subscriptionResponse(request(), text, 'm3u8').text(), text);
});

test('Range 按字节切片，支持闭区间、开放区间、后缀和超出末尾的范围', async () => {
  for (const [range, start, end] of [
    ['bytes=0-7', 0, 7], ['bytes=30-33', 30, 33],
    ['bytes=8-', 8, bytes.length - 1], ['bytes=-7', bytes.length - 7, bytes.length - 1],
    ['bytes=0-9999', 0, bytes.length - 1], ['bytes=-9999', 0, bytes.length - 1],
  ]) {
    const result = subscriptionResponse(request({ Range: range }), text, 'm3u');
    assert.equal(result.status, 206, range);
    assert.equal(result.headers.get('content-range'), `bytes ${start}-${end}/${bytes.length}`);
    assert.equal(result.headers.get('content-length'), String(end - start + 1));
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes.slice(start, end + 1));
  }
});

test('不可满足范围返回 416；不支持或无效的 Range、If-Range 回退完整文件', async () => {
  for (const range of [`bytes=${bytes.length}-`, 'bytes=-0', 'bytes=99999-999999']) {
    const result = subscriptionResponse(request({ Range: range }), text, 'm3u');
    assert.equal(result.status, 416, range);
    assert.equal(result.headers.get('content-range'), `bytes */${bytes.length}`);
    assert.equal(await result.text(), '');
  }
  for (const headers of [{ Range: 'bytes=8-2' }, { Range: 'items=0-1' }, { Range: 'bytes=0-1,3-4' }, { Range: 'bytes=-' }, { Range: 'bytes=0-7', 'If-Range': '"old-version"' }]) {
    const result = subscriptionResponse(request(headers), text, 'm3u');
    assert.equal(result.status, 200);
    assert.equal(await result.text(), text);
  }
});
