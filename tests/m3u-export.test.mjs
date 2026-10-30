import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportPlaylist, parsePlaylist } from '../lib/m3u.js';
import { subscriptionResponse } from '../lib/subscription-response.js';

test('M3U 按参考结构输出，保留 EPG、已有映射、台标、额外属性及播放器参数', () => {
  const source = '#EXTM3U x-tvg-url="https://example.com/epg.xml"\n#EXTINF:0 tvg-id="27" tvg-name="CCTV5" tvg-logo="https://example.com/5.png" catchup="append", 体育频道\n#EXTGRP:央视频道\n#EXTVLCOPT:http-user-agent=Player\nhttps://example.com/live.m3u8?key=1&auth=2\n';
  const expected = '#EXTM3U x-tvg-url="https://example.com/epg.xml"\n#EXTINF:-1 tvg-name="CCTV5" tvg-id="27" tvg-logo="https://example.com/5.png" group-title="央视频道" catchup="append", 体育频道\n#EXTGRP:央视频道\n#EXTVLCOPT:http-user-agent=Player\nhttps://example.com/live.m3u8?key=1&auth=2\n';
  assert.equal(exportPlaylist(source, 'm3u'), expected);
  assert.equal(exportPlaylist(expected, 'm3u'), expected);
});

test('TXT 与 JSON 转出的 M3U 使用相同结构，缺失元数据留空且正确转义名称', () => {
  const txt = parsePlaylist('央视频道,#genre#\nCCTV1,https://example.com/1');
  assert.equal(exportPlaylist(txt.text, 'm3u'), '#EXTM3U\n#EXTINF:-1 tvg-name="CCTV1" tvg-id="" tvg-logo="" group-title="央视频道", CCTV1\nhttps://example.com/1\n');
  const json = parsePlaylist(JSON.stringify([{ name: '频道 "A&B",高清', url: 'https://example.com/a', tvgId: 'id-1', logo: 'https://example.com/logo.png', group: '测试' }]));
  assert.match(exportPlaylist(json.text, 'm3u'), /tvg-name="频道 &quot;A&amp;B&quot;,高清" tvg-id="id-1" tvg-logo="https:\/\/example.com\/logo.png" group-title="测试", 频道 "A&B",高清/);
});

test('M3U 和 M3U8 使用参考媒体类型，GET 与 HEAD 的长度基于格式化后的内容', async () => {
  const source = '#EXTM3U\n#EXTINF:-1,中文频道\nhttps://example.com/live\n';
  for (const format of ['m3u', 'm3u8']) {
    const get = subscriptionResponse(new Request('https://example.com/list'), source, format);
    const head = subscriptionResponse(new Request('https://example.com/list', { method: 'HEAD' }), source, format);
    assert.equal(get.headers.get('content-type'), 'audio/x-mpegurl; charset=utf-8');
    assert.equal(await get.text(), exportPlaylist(source, 'm3u'));
    assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(exportPlaylist(source, 'm3u'))));
    assert.equal(await head.text(), '');
  }
});
