import { stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const downloadsDirectory = fileURLToPath(new URL('./downloads/', import.meta.url));

/**
 * Resolve and validate the directory that will be selected by the injected
 * file input. The browser reads the files itself; Node only enforces the
 * existing downloads/ boundary and reports useful path errors.
 */
export async function resolveLocalImagesDirectory(subdirectory = '.') {
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
