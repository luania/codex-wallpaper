import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const allIllustrationsLimit = Number.MAX_SAFE_INTEGER;

type ArtistOptions = {
  userId: string;
  configPath: string;
  outputDirectory: string;
};

function usage(): void {
  console.log(`用法：
  pnpm download:artist <画师 ID>
  pnpm download:artist --user <画师 ID>
  pnpm download:artist <Pixiv 画师主页 URL> [选项]

选项：
  --config <路径>  PixivFlow 配置文件（默认自动查找 pixivflow-ranking.config.json）
  --output <路径>  图片输出目录（默认 downloads/artists/<画师 ID>）
  -h, --help       显示帮助

示例：
  pnpm download:artist 123456
  pnpm download:artist https://www.pixiv.net/users/123456
  pnpm download:artist --user 123456 --output ./downloads/my-artist
`);
}

function parseUserId(input: string): string {
  const value = input.trim();
  if (/^\d+$/.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`画师 ID 或 Pixiv 主页 URL 无效：${input}`);
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname !== 'pixiv.net' && !hostname.endsWith('.pixiv.net')) {
    throw new Error(`不是 Pixiv 主页 URL：${input}`);
  }
  const match = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?users\/(\d+)(?:\/|$)/i);
  if (!match?.[1]) throw new Error(`Pixiv 主页 URL 中没有找到画师 ID：${input}`);
  return match[1];
}

function findConfigPath(explicitPath: string | undefined): string {
  if (explicitPath) {
    const path = resolvePath(process.cwd(), explicitPath);
    if (!existsSync(path)) throw new Error(`找不到配置文件：${path}`);
    return path;
  }

  const candidates = [
    process.env.PIXIV_DOWNLOADER_CONFIG,
    resolvePath(projectDirectory, 'pixivflow-ranking.config.json'),
    resolvePath(projectDirectory, 'config/standalone.config.json'),
    resolvePath(projectDirectory, 'standalone.config.json'),
  ].filter((path): path is string => Boolean(path));
  const found = candidates.map((path) => resolvePath(process.cwd(), path)).find((path) => existsSync(path));
  if (found) return found;

  throw new Error(
    '找不到 PixivFlow 配置文件，请准备 pixivflow-ranking.config.json，或使用 --config <路径> 指定配置文件',
  );
}

function parseOptions(args: string[]): ArtistOptions | null {
  const { values, positionals } = parseArgs({
    args,
    options: {
      user: { type: 'string', short: 'u' },
      config: { type: 'string' },
      output: { type: 'string', short: 'o' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help) {
    usage();
    return null;
  }
  if (positionals.length > 1) throw new Error('只能指定一个画师 ID 或 Pixiv 主页 URL');
  if (values.user && positionals.length > 0) {
    throw new Error('--user 不能和位置参数同时使用');
  }

  const input = values.user ?? positionals[0];
  if (!input) throw new Error('请指定画师 ID 或 Pixiv 主页 URL（使用 --help 查看用法）');

  const userId = parseUserId(input);
  const outputDirectory = resolvePath(
    process.cwd(),
    values.output ?? join('downloads', 'artists', userId),
  );
  return {
    userId,
    configPath: findConfigPath(values.config),
    outputDirectory,
  };
}

function runPixivFlow(options: ArtistOptions): Promise<number> {
  const pixivFlowEntry = resolvePath(projectDirectory, 'node_modules/pixivflow/dist/index.js');
  if (!existsSync(pixivFlowEntry)) {
    throw new Error('找不到 pixivflow，请先执行 pnpm install');
  }

  const mirrorPatch = resolvePath(projectDirectory, 'data/pixivflow-image-mirror.cjs');
  const args = [] as string[];
  if (existsSync(mirrorPatch)) args.push('--require', mirrorPatch);
  args.push(
    pixivFlowEntry,
    'download',
    '--config',
    options.configPath,
    '--targets',
    JSON.stringify([{
      type: 'illustration',
      tag: `artist-${options.userId}`,
      userId: options.userId,
      // PixivFlow follows next_url until it reaches the end of the user's list.
      limit: allIllustrationsLimit,
    }]),
  );

  const environment = {
    ...process.env,
    // Keep the artist run isolated from the ranking output directory. Setting
    // both values also allows an explicitly supplied output outside downloads/.
    PIXIV_DOWNLOAD_DIR: options.outputDirectory,
    PIXIV_ILLUSTRATION_DIR: options.outputDirectory,
    // Do not let an artwork downloaded by the daily/monthly job suppress it
    // from this artist archive. Repeated artist runs still share this record.
    PIXIV_DATABASE_PATH: resolvePath(projectDirectory, 'data', `pixiv-artist-${options.userId}.db`),
    // The ranking config may enable first-page-only wallpaper mode. An artist
    // archive should retain every page of every illustration.
    PIXIV_WALLPAPER_FIRST_PAGE_ONLY: 'false',
  };

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectDirectory,
      env: environment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        resolve(1);
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options) return;
  await mkdir(resolvePath(projectDirectory, 'data'), { recursive: true });
  await mkdir(options.outputDirectory, { recursive: true });
  console.log(`开始下载画师 ${options.userId} 的全部插画，保存至 ${options.outputDirectory}`);
  const exitCode = await runPixivFlow(options);
  if (exitCode !== 0) process.exitCode = exitCode;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { parseUserId, parseOptions, runPixivFlow };
