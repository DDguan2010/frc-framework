import { stat } from 'node:fs/promises';
import path from 'node:path';

import { app, BrowserWindow, screen, session } from 'electron';
import started from 'electron-squirrel-startup';

import { IPC_CHANNELS, type ProjectOpenResult, type WindowState } from '../shared/ipc.js';
import { registerIpcHandlers, unregisterIpcHandlers } from './ipc.js';
import { isAbortedNavigation, isRendererReload } from './renderer-navigation.js';
import { ProjectService } from './project-service.js';
import { NtService } from './nt-service.js';
import { ToolchainService } from './toolchain-service.js';
import { SettingsStore } from './settings-store.js';

const isSmokeTest = process.argv.includes('--smoke-test');
const isDevSmokeTest = process.argv.includes('--dev-smoke-test');
const isAnySmokeTest = isSmokeTest || isDevSmokeTest;
const ownsSingleInstance = isAnySmokeTest || app.requestSingleInstanceLock();
const rendererReadyExpression = `Boolean(customElements.get('frc-framework-app')) &&
  document.querySelector('frc-framework-app')?.shadowRoot !== null &&
  typeof window.framework === 'object'`;
let settings: SettingsStore | undefined;
let projects: ProjectService | undefined;
let networkTables: NtService | undefined;
let toolchain: ToolchainService | undefined;
let pendingProjectPath: string | undefined;
const rendererReadyWindows = new WeakSet<BrowserWindow>();

if (started || !ownsSingleInstance) {
  app.quit();
}

function createMainWindow(): BrowserWindow {
  const windowState = settings?.state.window;
  const bounds = visibleBounds(windowState);
  const mainWindow = new BrowserWindow({
    ...bounds,
    backgroundColor: '#101114',
    icon: appIconPath(),
    minHeight: Math.min(640, bounds.height),
    minWidth: Math.min(1040, bounds.width),
    show: false,
    title: 'FRC Framework',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
    },
  });

  if (windowState?.maximized === true) {
    mainWindow.maximize();
  }
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isRendererReload(mainWindow.webContents.getURL(), navigationUrl)) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    const isExpectedViteReload = MAIN_WINDOW_VITE_DEV_SERVER_URL !== undefined && code === -3;
    if (isMainFrame && !isExpectedViteReload) {
      rendererReadyWindows.delete(mainWindow);
      console.error(`Renderer failed to load ${url} (${code}): ${description}`);
    }
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    rendererReadyWindows.delete(mainWindow);
    console.error(`Renderer process exited (${details.reason}, code ${details.exitCode}).`);
  });

  void ensureRendererLoaded(mainWindow);

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const saveWindow = (): void => {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      const bounds = mainWindow.getNormalBounds();
      void settings?.patchWindow({
        height: bounds.height,
        maximized: mainWindow.isMaximized(),
        width: bounds.width,
        x: bounds.x,
        y: bounds.y,
      });
    }, 150);
  };
  mainWindow.on('resize', saveWindow);
  mainWindow.on('move', saveWindow);
  mainWindow.on('maximize', saveWindow);
  mainWindow.on('unmaximize', saveWindow);

  return mainWindow;
}

const rendererLoads = new WeakMap<BrowserWindow, Promise<void>>();

function ensureRendererLoaded(mainWindow: BrowserWindow): Promise<void> {
  const active = rendererLoads.get(mainWindow);
  if (active !== undefined) return active;
  const load = loadAndRevealRenderer(mainWindow).finally(() => rendererLoads.delete(mainWindow));
  rendererLoads.set(mainWindow, load);
  return load;
}

async function loadAndRevealRenderer(mainWindow: BrowserWindow): Promise<void> {
  const rendererUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL;
  const rendererFile = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
  const maximumAttempts = rendererUrl === undefined ? 1 : 4;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      if (attempt === 1) {
        if (rendererUrl === undefined) {
          await mainWindow.loadFile(rendererFile);
        } else {
          await mainWindow.loadURL(rendererUrl);
        }
      } else {
        console.warn(
          'Development renderer was not mounted; retrying with a cache-bypassing reload.',
        );
        await reloadIgnoringCache(mainWindow);
      }
    } catch (error) {
      if (!isAbortedNavigation(error)) {
        console.error(`Renderer startup attempt ${attempt} failed:`, error);
      }
    }

    // Vite deliberately aborts the first navigation when dependency optimization
    // completes and then reloads the same origin. Waiting here lets that reload
    // finish instead of treating ERR_ABORTED as a terminal load failure.
    if (await waitForRenderer(mainWindow, rendererUrl === undefined ? 5_000 : 12_000)) {
      rendererDidBecomeReady(mainWindow);
      return;
    }
  }

  console.error('Renderer did not mount after all startup attempts.');
  if (isAnySmokeTest) {
    app.exit(1);
    return;
  }
  await showRendererFailure(mainWindow);
}

async function waitForRenderer(mainWindow: BrowserWindow, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!mainWindow.isDestroyed() && Date.now() < deadline) {
    try {
      if (await mainWindow.webContents.executeJavaScript(rendererReadyExpression, true)) {
        return true;
      }
    } catch {
      // A Vite dependency graph restart briefly replaces the execution context.
    }
    await delay(100);
  }
  return false;
}

function reloadIgnoringCache(mainWindow: BrowserWindow): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      mainWindow.webContents.off('did-finish-load', onLoaded);
      mainWindow.webContents.off('did-fail-load', onFailed);
    };
    const onLoaded = (): void => {
      cleanup();
      resolve();
    };
    const onFailed = (
      _event: Electron.Event,
      code: number,
      description: string,
      _url: string,
      isMainFrame: boolean,
    ): void => {
      if (!isMainFrame) return;
      cleanup();
      reject(new Error(`Reload failed (${code}): ${description}`));
    };
    mainWindow.webContents.once('did-finish-load', onLoaded);
    mainWindow.webContents.on('did-fail-load', onFailed);
    mainWindow.webContents.reloadIgnoringCache();
  });
}

function rendererDidBecomeReady(mainWindow: BrowserWindow): void {
  rendererReadyWindows.add(mainWindow);
  if (isAnySmokeTest) {
    console.log(isDevSmokeTest ? 'DEV_SMOKE_OK' : 'PACKAGED_SMOKE_OK');
    app.exit(0);
    return;
  }
  if (!mainWindow.isMaximized()) {
    mainWindow.setBounds(screen.getDisplayMatching(mainWindow.getBounds()).workArea);
  }
  mainWindow.show();

  const projectPath = pendingProjectPath;
  pendingProjectPath = undefined;
  if (projectPath !== undefined) {
    void openAndNotify(mainWindow, projectPath);
  }
}

async function showRendererFailure(mainWindow: BrowserWindow): Promise<void> {
  const message = encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8">
    <title>FRC Framework - Renderer error</title></head><body>
    <h1>FRC Framework could not load its interface.</h1>
    <p>Close the window and run pnpm dev again. Startup details were written to the terminal.</p>
    </body></html>`);
  await mainWindow.loadURL(`data:text/html;charset=utf-8,${message}`);
  mainWindow.show();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function configureContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "font-src 'self'; img-src 'self' data:; connect-src 'self' ws:; " +
            "object-src 'none'; base-uri 'none'; frame-ancestors 'none';",
        ],
      },
    });
  });
}

if (ownsSingleInstance && !started)
  void app.whenReady().then(async () => {
    settings = new SettingsStore(path.join(app.getPath('userData'), 'state.json'));
    await settings.load();
    projects = new ProjectService(settings, baseTemplatePath(), {
      javaWasmPath: javaGrammarPath(),
      runtimeWasmPath: treeSitterRuntimePath(),
      // Generic CI hosts do not install the WPILib JDK. This explicit launch-only test hook keeps
      // production creation validated while letting packaged E2E exercise the filesystem transaction.
      validateCreatedProject: !process.argv.includes('--e2e-skip-gradle'),
    });
    projects.onFilesChanged((events) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.projectFilesChanged, events);
      }
    });
    networkTables = new NtService();
    toolchain = new ToolchainService(projects);
    configureContentSecurityPolicy();
    registerIpcHandlers(settings, projects, networkTables, toolchain);
    pendingProjectPath ??= await commandLineProjectPath(process.argv);
    createMainWindow();

    if (isAnySmokeTest) {
      setTimeout(() => {
        console.error(`${isDevSmokeTest ? 'Development' : 'Packaged'} smoke test timed out.`);
        app.exit(1);
      }, 30_000).unref();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

if (ownsSingleInstance && !started) {
  app.on('second-instance', () => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow === undefined) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    // A second `pnpm dev` is commonly an attempt to recover a transient Vite
    // startup failure. Reuse the original server and window instead of letting
    // two Electron instances contend for the same Chromium/Vite caches.
    if (!rendererReadyWindows.has(mainWindow)) void ensureRendererLoaded(mainWindow);
  });
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  const window = BrowserWindow.getAllWindows()[0];
  if (window === undefined) {
    pendingProjectPath = filePath;
  } else {
    void openAndNotify(window, filePath);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  unregisterIpcHandlers();
  void projects?.close();
  networkTables?.dispose();
  toolchain?.dispose();
});

async function openAndNotify(window: BrowserWindow, projectPath: string): Promise<void> {
  try {
    const project = await projects?.open(projectPath);
    if (project !== undefined) {
      window.webContents.send(IPC_CHANNELS.projectOpened, project satisfies ProjectOpenResult);
    }
  } catch (error) {
    console.error(`Could not open command-line project ${projectPath}:`, error);
  }
}

function visibleBounds(state: WindowState | undefined): Electron.Rectangle {
  if (state?.x === undefined || state.y === undefined) return screen.getPrimaryDisplay().workArea;
  return screen.getDisplayMatching({
    height: state.height,
    width: state.width,
    x: state.x,
    y: state.y,
  }).workArea;
}

function appIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'resources', 'icons', 'icon.png')
    : path.resolve(__dirname, '..', '..', '..', '..', 'resources', 'icons', 'icon.png');
}

function baseTemplatePath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'resources', 'base-template')
    : path.resolve(__dirname, '..', '..', '..', '..', 'resources', 'base-template');
}

function javaGrammarPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tree-sitter-java.wasm')
    : path.resolve(
        app.getAppPath(),
        '../../node_modules/tree-sitter-wasms/out/tree-sitter-java.wasm',
      );
}

function treeSitterRuntimePath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tree-sitter.wasm')
    : path.resolve(app.getAppPath(), '../../node_modules/web-tree-sitter/tree-sitter.wasm');
}

async function commandLineProjectPath(argv: readonly string[]): Promise<string | undefined> {
  const applicationPath = path.resolve(app.getAppPath());
  for (const argument of argv.slice(1).reverse()) {
    if (argument.startsWith('-')) {
      continue;
    }
    try {
      const resolved = path.resolve(argument);
      if (resolved === applicationPath) continue;
      if ((await stat(resolved)).isDirectory()) {
        return resolved;
      }
    } catch {
      // Ignore Electron/Forge arguments and non-path values.
    }
  }
  return undefined;
}
