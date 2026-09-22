import { readdir } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const downloadsDirectory = fileURLToPath(new URL('./downloads/', import.meta.url));
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

async function imageFiles(directory: string, rootDirectory = directory): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await imageFiles(path, rootDirectory));
    } else if (entry.isFile() && mimeTypes[extname(entry.name).toLowerCase()]) {
      files.push(relative(rootDirectory, path));
    }
  }
  return files.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

export async function loadLocalImages(subdirectory = '.') {
  const directory = resolve(downloadsDirectory, subdirectory);
  const relativeDirectory = relative(downloadsDirectory, directory);
  if (
    isAbsolute(subdirectory) || isAbsolute(relativeDirectory) ||
    relativeDirectory === '..' || relativeDirectory.startsWith(`..${sep}`)
  ) {
    throw new Error('请指定相对于 downloads/ 的子目录，不能使用绝对路径或跳出 downloads/');
  }
  let files;
  try {
    files = await imageFiles(directory, downloadsDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`下载目录不存在：${directory}。请先运行下载命令`);
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') {
      throw new Error(`下载路径不是目录：${directory}`);
    }
    throw error;
  }
  if (files.length === 0) {
    throw new Error(`downloads/ 中没有支持的图片：${directory}。请先运行下载命令`);
  }

  const images = files.map((file) => {
    const urlPath = file.split(sep).map(encodeURIComponent).join('/');
    return `http://127.0.0.1:5500/downloads/${urlPath}`;
  });
  return { directory, images };
}
