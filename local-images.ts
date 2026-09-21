import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultImagesDirectory = fileURLToPath(new URL('./imgs/', import.meta.url));
const mimeTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

async function imageFiles(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && mimeTypes[extname(entry.name).toLowerCase()])
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

async function latestDirectory() {
  let entries;
  try {
    entries = await readdir(defaultImagesDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('尚无本地图片，请先运行 pnpm download，或通过 --dir 指定图片目录');
    }
    throw error;
  }

  const dates = entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const date of dates) {
    const directory = join(defaultImagesDirectory, date);
    if ((await imageFiles(directory)).length > 0) return directory;
  }
  // Preserve support for images downloaded before date subdirectories existed.
  return defaultImagesDirectory;
}

export async function loadLocalImages(requestedDirectory?: string) {
  const directory = requestedDirectory === undefined
    ? await latestDirectory()
    : resolve(requestedDirectory);
  let files;
  try {
    files = await imageFiles(directory);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw new Error(`图片目录不存在或不是目录：${directory}`);
    }
    throw error;
  }
  if (files.length === 0) {
    throw new Error(`目录中没有支持的图片：${directory}。请先运行 pnpm download 或指定其他目录`);
  }

  const images: string[] = [];
  for (const file of files) {
    const body = await readFile(join(directory, file));
    if (body.length === 0) {
      console.warn(`跳过空图片：${file}`);
      continue;
    }
    images.push(`data:${mimeTypes[extname(file).toLowerCase()]};base64,${body.toString('base64')}`);
  }
  if (images.length === 0) throw new Error(`目录中的图片均为空：${directory}`);
  return { directory, images };
}
