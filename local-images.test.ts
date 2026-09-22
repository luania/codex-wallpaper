import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { imageSizeFromFile } from 'image-size/fromFile';
import { orientationFromDimensions } from './local-images.ts';

function pngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from('\x89PNG\r\n\x1a\n', 'binary').copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

function gifHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(10);
  header.write('GIF89a', 0, 'ascii');
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  return header;
}

function jpegHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(29);
  header.writeUInt16BE(0xffd8, 0);
  header.writeUInt16BE(0xffe0, 2);
  header.writeUInt16BE(4, 4);
  header.writeUInt16BE(0xffc0, 8);
  header.writeUInt16BE(17, 10);
  header[12] = 8;
  header.writeUInt16BE(height, 13);
  header.writeUInt16BE(width, 15);
  header[17] = 3;
  for (let index = 0; index < 3; index++) {
    const offset = 18 + index * 3;
    header[offset] = index + 1;
    header[offset + 1] = 0x11;
  }
  header.writeUInt16BE(0xffd9, 27);
  return header;
}

function webpHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(30);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(22, 4);
  header.write('WEBPVP8X', 8, 'ascii');
  header.writeUInt32LE(10, 16);
  header[24] = (width - 1) & 0xff;
  header[25] = ((width - 1) >> 8) & 0xff;
  header[26] = (width - 1) >> 16;
  header[27] = (height - 1) & 0xff;
  header[28] = ((height - 1) >> 8) & 0xff;
  header[29] = (height - 1) >> 16;
  return header;
}

function bmpHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(26);
  header.write('BM', 0, 'ascii');
  header.writeUInt32LE(54, 2);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  return header;
}

test('reads common image headers without decoding full image data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-theme-images-'));
  try {
    const fixtures = [
      ['wide.png', pngHeader(1600, 900), [1600, 900]],
      ['square.gif', gifHeader(800, 800), [800, 800]],
      ['tall.jpg', jpegHeader(700, 1000), [700, 1000]],
      ['wide.webp', webpHeader(1200, 700), [1200, 700]],
      ['wide.bmp', bmpHeader(900, 600), [900, 600]],
      ['portrait.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"/>', [600, 900]],
    ] as const;
    for (const [name, contents] of fixtures) await writeFile(join(directory, name), contents);

    for (const [name, , expected] of fixtures) {
      const dimensions = await imageSizeFromFile(join(directory, name));
      assert.deepEqual([dimensions.width, dimensions.height], expected);
      assert.equal(
        orientationFromDimensions(dimensions),
        expected[0] >= expected[1] ? 'landscape' : 'portrait',
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('treats square and EXIF-rotated dimensions as landscape/portrait correctly', () => {
  assert.equal(orientationFromDimensions({ width: 800, height: 800 }), 'landscape');
  assert.equal(orientationFromDimensions({ width: 600, height: 1200, orientation: 6 }), 'landscape');
  assert.equal(orientationFromDimensions({ width: 1200, height: 600, orientation: 8 }), 'portrait');
  assert.equal(orientationFromDimensions({ width: 0, height: 1200 }), undefined);
});

test('keeps damaged files available for browser fallback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-theme-images-'));
  try {
    const damaged = join(directory, 'damaged.png');
    await writeFile(damaged, 'not an image');
    await assert.rejects(imageSizeFromFile(damaged));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
