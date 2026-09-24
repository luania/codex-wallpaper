import { readdir, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageSizeFromFile } from 'image-size/fromFile';

const downloadsDirectory = fileURLToPath(new URL('./downloads/', import.meta.url));
const metadataConcurrency = 16;
export type ImageOrientation = 'landscape' | 'portrait';
export type LocalImage = {
  /** Path relative to the directory passed to setInputFiles(). */
  path: string;
  orientation?: ImageOrientation;
};
const supportedExtensions = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp', '.svg',
]);

async function imageFiles(directory: string, rootDirectory = directory): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await imageFiles(path, rootDirectory));
    } else if (entry.isFile() && supportedExtensions.has(extname(entry.name).toLowerCase())) {
      files.push(relative(rootDirectory, path));
    }
  }
  return files.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

export function orientationFromDimensions(dimensions: {
  width: number;
  height: number;
  orientation?: number;
}): ImageOrientation | undefined {
  if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height) ||
      dimensions.width <= 0 || dimensions.height <= 0) {
    return undefined;
  }
  const swapsDimensions = [5, 6, 7, 8].includes(dimensions.orientation ?? 0);
  const width = swapsDimensions ? dimensions.height : dimensions.width;
  const height = swapsDimensions ? dimensions.width : dimensions.height;
  return width >= height ? 'landscape' : 'portrait';
}

async function resolveDirectory(subdirectory = '.') {
  const directory = resolve(downloadsDirectory, subdirectory);
  const relativeDirectory = relative(downloadsDirectory, directory);
  if (
    isAbsolute(subdirectory) || isAbsolute(relativeDirectory) ||
    relativeDirectory === '..' || relativeDirectory.startsWith(`..${sep}`)
  ) {
    throw new Error('请指定相对于 downloads/ 的子目录，不能使用绝对路径或跳出 downloads/');
  }

  try {
    const details = await stat(directory);
    if (!details.isDirectory()) {
      throw new Error(`下载路径不是目录：${directory}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('下载路径不是目录：')) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`下载目录不存在：${directory}。请先运行下载命令`);
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') {
      throw new Error(`下载路径不是目录：${directory}`);
    }
    throw error;
  }
  return directory;
}

export async function resolveLocalImagesDirectory(subdirectory = '.') {
  return resolveDirectory(subdirectory);
}

export async function loadLocalImages(subdirectory = '.') {
  const directory = await resolveDirectory(subdirectory);
  let files: string[];
  try {
    files = await imageFiles(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`下载目录不存在：${directory}。请先运行下载命令`);
    }
    throw error;
  }
  if (files.length === 0) {
    throw new Error(`downloads/ 中没有支持的图片：${directory}。请先运行下载命令`);
  }

  const images: (LocalImage | undefined)[] = new Array(files.length);
  let nextIndex = 0;
  async function readMetadataWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= files.length) return;
      const file = files[index]!;
      const image: LocalImage = { path: file.split(sep).join('/') };
      try {
        const dimensions = await imageSizeFromFile(join(directory, file));
        const orientation = orientationFromDimensions(dimensions);
        if (orientation) image.orientation = orientation;
      } catch (error) {
        console.warn(`无法读取图片尺寸，将在浏览器中回退解析：${join(directory, file)}`, error);
      }
      images[index] = image;
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(metadataConcurrency, files.length) }, () => readMetadataWorker()),
  );
  return {
    directory,
    images: images.filter((image): image is LocalImage => Boolean(image)),
  };
}
