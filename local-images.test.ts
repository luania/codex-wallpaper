import assert from 'node:assert/strict';
import test from 'node:test';
import { orientationFromDimensions, resolveLocalImagesDirectory } from './local-images.ts';

test('uses EXIF-aware dimensions for orientation metadata', () => {
  assert.equal(orientationFromDimensions({ width: 1600, height: 900 }), 'landscape');
  assert.equal(orientationFromDimensions({ width: 600, height: 1200 }), 'portrait');
  assert.equal(orientationFromDimensions({ width: 600, height: 1200, orientation: 6 }), 'landscape');
  assert.equal(orientationFromDimensions({ width: 800, height: 800 }), 'landscape');
  assert.equal(orientationFromDimensions({ width: 0, height: 100 }), undefined);
});

test('resolves the default downloads directory', async () => {
  const directory = await resolveLocalImagesDirectory();
  assert.match(directory, /[\\/]downloads$/);
});

test('keeps directory arguments inside downloads/', async () => {
  await assert.rejects(
    resolveLocalImagesDirectory('../'),
    /不能使用绝对路径或跳出 downloads\//,
  );
  await assert.rejects(
    resolveLocalImagesDirectory('/tmp'),
    /不能使用绝对路径或跳出 downloads\//,
  );
});

test('reports missing and non-directory paths', async () => {
  await assert.rejects(
    resolveLocalImagesDirectory('does-not-exist'),
    /下载目录不存在：.*does-not-exist/,
  );
  await assert.rejects(
    resolveLocalImagesDirectory('ranking-monthly-safe-top100.json'),
    /下载路径不是目录：.*ranking-monthly-safe-top100\.json/,
  );
});
