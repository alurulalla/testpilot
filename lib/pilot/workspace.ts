/**
 * Workspace — isolated output directory per target URL.
 *
 * Structure: .testpilot/<session-id>/<url-slug>/
 *   ├── site_map.json
 *   ├── tests/
 *   ├── reports/
 *   ├── snapshots/
 *   └── playwright.config.ts
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

export interface WorkspaceConfig {
  /** Root directory (default: .testpilot in cwd). The URL slug is appended to get workspace.dir. */
  rootDir?: string;
  /** Target URL this workspace is for. */
  url: string;
}

function urlToSlug(url: string): string {
  try {
    const parsed = new URL(url);
    let slug = parsed.hostname.replace(/\./g, '-');
    if (parsed.pathname && parsed.pathname !== '/') {
      slug += parsed.pathname.replace(/\//g, '-').replace(/-$/, '');
    }
    return slug.slice(0, 80);
  } catch {
    return url.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 80);
  }
}

export class Workspace {
  readonly url: string;
  readonly slug: string;
  readonly dir: string;
  readonly testsDir: string;
  readonly reportsDir: string;
  readonly snapshotsDir: string;
  readonly siteMapFile: string;
  readonly configFile: string;

  constructor(config: WorkspaceConfig) {
    this.url = config.url;
    this.slug = urlToSlug(config.url);
    const rootDir = config.rootDir ?? path.join(process.cwd(), '.testpilot');
    this.dir = path.join(rootDir, this.slug);
    this.testsDir = path.join(this.dir, 'tests');
    this.reportsDir = path.join(this.dir, 'reports');
    this.snapshotsDir = path.join(this.dir, 'snapshots');
    this.siteMapFile = path.join(this.dir, 'site_map.json');
    this.configFile = path.join(this.dir, 'playwright.config.ts');
  }

  init(): void {
    for (const d of [this.testsDir, this.reportsDir, this.snapshotsDir]) {
      mkdirSync(d, { recursive: true });
    }
    if (!existsSync(this.configFile)) this.writePlaywrightConfig();
    if (!existsSync(path.join(this.dir, 'package.json'))) this.writePackageJson();
    if (!existsSync(path.join(this.dir, 'tsconfig.json'))) this.writeTsConfig();
    if (!existsSync(path.join(this.dir, '.gitignore'))) this.writeGitIgnore();
  }

  private writePackageJson(): void {
    const pkg = {
      name: `testpilot-tests-${this.slug}`,
      version: '1.0.0',
      private: true,
      scripts: {
        test: 'npx playwright test',
        'test:headed': 'npx playwright test --headed',
        'test:debug': 'npx playwright test --debug',
      },
      devDependencies: {
        '@playwright/test': '^1.52.0',
        typescript: '^5.7.0',
      },
    };
    writeFileSync(
      path.join(this.dir, 'package.json'),
      JSON.stringify(pkg, null, 2) + '\n',
      'utf8',
    );
  }

  private writeTsConfig(): void {
    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        esModuleInterop: true,
        resolveJsonModule: true,
      },
      include: ['tests/**/*.ts', 'playwright.config.ts'],
    };
    writeFileSync(
      path.join(this.dir, 'tsconfig.json'),
      JSON.stringify(tsconfig, null, 2) + '\n',
      'utf8',
    );
  }

  private writeGitIgnore(): void {
    writeFileSync(
      path.join(this.dir, '.gitignore'),
      'node_modules/\ntest-results/\nreports/\nplaywright-report/\nblob-report/\n.cache/\n',
      'utf8',
    );
  }

  async installDeps(): Promise<void> {
    const nodeModulesDir = path.join(this.dir, 'node_modules');
    if (existsSync(nodeModulesDir)) return;

    if (process.env.VERCEL === '1') {
      // On Vercel the filesystem is read-only (except /tmp), there is no npm
      // home directory, and Playwright's bundled Chromium isn't available.
      // Instead, symlink the workspace node_modules to the app-level
      // node_modules at /var/task/node_modules so `npx playwright test` can
      // resolve @playwright/test and the playwright CLI without a fresh install.
      // The Chromium binary is supplied by @sparticuz/chromium at runtime.
      const appNodeModules = path.join(process.cwd(), 'node_modules');
      try {
        symlinkSync(appNodeModules, nodeModulesDir);
      } catch (e) {
        // Symlink may fail if another concurrent request already created it
        if (!existsSync(nodeModulesDir)) throw e;
      }
      return;
    }

    console.log('Installing dependencies in workspace...');
    execSync('npm install', { cwd: this.dir, stdio: 'inherit' });
    console.log('Installing Playwright chromium browser...');
    execSync('npx playwright install chromium', { cwd: this.dir, stdio: 'inherit' });
  }

  writePlaywrightConfig(): void {
    const baseUrl = JSON.stringify(this.url);
    const config = `import { defineConfig } from '@playwright/test';

// On Vercel/serverless, Playwright's bundled Chromium isn't available.
// runTestsAsync resolves @sparticuz/chromium and passes the path via env var.
const _exePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

// Serverless-safe Chrome flags: required when running inside a Lambda container.
const _serverlessArgs = _exePath
  ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
     '--single-process', '--no-zygote', '--disable-gpu']
  : [];

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // workers: 1 prevents multiple Chromium instances running simultaneously,
  // which would exhaust Lambda memory (each instance uses ~150-200 MB).
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['json', { outputFile: './reports/report.json' }]],
  use: {
    baseURL: ${baseUrl},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: _exePath,
          args: _serverlessArgs,
        },
      },
    },
  ],
});
`;
    writeFileSync(this.configFile, config, 'utf8');
  }

  path(...segments: string[]): string {
    return path.join(this.dir, ...segments);
  }

  get reportFile(): string {
    return path.join(this.reportsDir, 'report.json');
  }

  readSiteMap(): unknown {
    if (!existsSync(this.siteMapFile)) return null;
    return JSON.parse(readFileSync(this.siteMapFile, 'utf8'));
  }

  writeSiteMap(data: unknown): void {
    writeFileSync(this.siteMapFile, JSON.stringify(data, null, 2), 'utf8');
  }

  testFiles(): string[] {
    if (!existsSync(this.testsDir)) return [];
    return readdirSync(this.testsDir)
      .filter(f => f.endsWith('.spec.ts'))
      .map(f => path.join(this.testsDir, f));
  }
}
