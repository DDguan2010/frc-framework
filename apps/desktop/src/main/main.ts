import { stat } from 'node:fs/promises';
import path from 'node:path';

import { app, BrowserWindow, screen, session } from 'electron';
import started from 'electron-squirrel-startup';

import { IPC_CHANNELS, type ProjectOpenResult, type WindowState } from '../shared/ipc.js';
import { registerIpcHandlers, unregisterIpcHandlers } from './ipc.js';
import { ProjectService } from './project-service.js';
import { NtService } from './nt-service.js';
import { ToolchainService } from './toolchain-service.js';
import { SettingsStore } from './settings-store.js';

const isSmokeTest = process.argv.includes('--smoke-test');
let settings: SettingsStore | undefined;
let projects: ProjectService | undefined;
let networkTables: NtService | undefined;
let toolchain: ToolchainService | undefined;
let pendingProjectPath: string | undefined;

if (started) {
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
  if (!isSmokeTest) {
    mainWindow.once('ready-to-show', () => {
      if (!mainWindow.isMaximized()) {
        mainWindow.setBounds(screen.getDisplayMatching(mainWindow.getBounds()).workArea);
      }
      mainWindow.show();
    });
  }

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL !== undefined) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

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

  mainWindow.webContents.once('did-finish-load', () => {
    const projectPath = pendingProjectPath;
    pendingProjectPath = undefined;
    if (projectPath !== undefined) {
      void openAndNotify(mainWindow, projectPath);
    }
  });

  if (isSmokeTest) {
    mainWindow.webContents.once('did-fail-load', (_event, code, description) => {
      console.error(`Smoke test renderer failed to load (${code}): ${description}`);
      app.exit(1);
    });
    mainWindow.webContents.once('did-finish-load', () => {
      void mainWindow.webContents
        .executeJavaScript(
          `Boolean(customElements.get('frc-framework-app')) &&
           document.querySelector('frc-framework-app') !== null &&
           typeof window.framework === 'object'`,
          true,
        )
        .then((ready: boolean) => {
          console.log(ready ? 'PACKAGED_SMOKE_OK' : 'PACKAGED_SMOKE_INVALID_RENDERER');
          app.exit(ready ? 0 : 1);
        })
        .catch((error: unknown) => {
          console.error('Smoke test renderer check failed:', error);
          app.exit(1);
        });
    });
  }
  return mainWindow;
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

  if (isSmokeTest) {
    setTimeout(() => {
      console.error('Packaged smoke test timed out.');
      app.exit(1);
    }, 15_000).unref();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

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
