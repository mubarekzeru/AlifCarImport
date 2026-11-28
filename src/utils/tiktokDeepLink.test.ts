import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTikTokAppLaunchProps } from './tiktokDeepLink';

const ANDROID_SAMSUNG_UA =
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
const IOS_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

test('buildTikTokAppLaunchProps builds Android snssdk1233 intent deep link when videoId is available', () => {
  const props = buildTikTokAppLaunchProps(
    'https://www.tiktok.com/@alif.car1/video/7412345678901234567',
    null,
    ANDROID_SAMSUNG_UA
  );
  assert.ok(props);
  assert.equal(props.target, undefined);
  assert.ok(props.href.startsWith('intent://aweme/detail/7412345678901234567#Intent;'));
  assert.ok(props.href.includes('package=com.zhiliaoapp.musically'));
  assert.ok(
    props.href.includes(
      `S.browser_fallback_url=${encodeURIComponent(
        'https://www.tiktok.com/@alif.car1/video/7412345678901234567'
      )}`
    )
  );
});

test('buildTikTokAppLaunchProps builds Android https intent deep link for vt.tiktok.com short links without videoId', () => {
  const props = buildTikTokAppLaunchProps(
    'https://vt.tiktok.com/ZSsD5H7AY/',
    null,
    ANDROID_SAMSUNG_UA
  );
  assert.ok(props);
  assert.equal(props.target, undefined);
  assert.ok(props.href.startsWith('intent://vt.tiktok.com/ZSsD5H7AY/#Intent;scheme=https;'));
  assert.ok(props.href.includes('package=com.zhiliaoapp.musically'));
  assert.ok(props.href.includes('S.browser_fallback_url=https%3A%2F%2Fvt.tiktok.com%2FZSsD5H7AY%2F'));
});

test('buildTikTokAppLaunchProps uses direct Universal Link on iOS without target=_blank', () => {
  const props = buildTikTokAppLaunchProps(
    'https://vt.tiktok.com/ZSsD5H7AY/',
    null,
    IOS_SAFARI_UA
  );
  assert.ok(props);
  assert.equal(props.href, 'https://vt.tiktok.com/ZSsD5H7AY/');
  assert.equal(props.target, undefined);
});

test('buildTikTokAppLaunchProps opens in a new tab on desktop browsers', () => {
  const props = buildTikTokAppLaunchProps(
    'https://vt.tiktok.com/ZSsD5H7AY/',
    null,
    DESKTOP_CHROME_UA
  );
  assert.ok(props);
  assert.equal(props.href, 'https://vt.tiktok.com/ZSsD5H7AY/');
  assert.equal(props.target, '_blank');
  assert.equal(props.rel, 'noopener noreferrer');
});

test('buildTikTokAppLaunchProps rejects javascript and non-TikTok URLs', () => {
  assert.equal(buildTikTokAppLaunchProps('javascript:alert(1)', null, ANDROID_SAMSUNG_UA), null);
  assert.equal(buildTikTokAppLaunchProps('https://evil.example.com/video/123', null, ANDROID_SAMSUNG_UA), null);
});
