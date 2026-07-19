import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';

import { I18n, type SupportedLocale } from '../../packages/i18n/src/index.js';

test('production shell is secure, accessible, and interactive', async () => {
  test.setTimeout(120_000);
  const require = createRequire(import.meta.url);
  const electronExecutable = require('electron') as string;
  const userData = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-e2e-'));
  const selectedProjectRoot = path.join(userData, 'project');
  await mkdir(selectedProjectRoot);
  // ProjectService returns a canonical path. This resolves Windows 8.3 aliases
  // (RUNNER~1) and macOS /var -> /private/var before asserting persisted state.
  const projectRoot = await realpath(selectedProjectRoot);
  const application = await electron.launch({
    args: [
      path.resolve('apps/desktop'),
      `--user-data-dir=${userData}`,
      '--e2e-skip-gradle',
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    ],
    executablePath: electronExecutable,
  });

  try {
    const page = await application.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const locale = ((await page.locator('html').getAttribute('lang')) ?? 'en') as SupportedLocale;
    const i18n = new I18n(locale);

    await expect(page).toHaveTitle('FRC Framework');
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) return;
      const bounds = window.getBounds();
      window.setSize(Math.min(bounds.width, 1040), Math.min(bounds.height, 720));
    });
    await expect(page.getByRole('navigation', { name: i18n.t('nav.workspace') })).toBeVisible();
    await expect(page.getByRole('button', { name: i18n.t('home.choose') })).toBeVisible();
    await expect(page.getByRole('complementary', { name: i18n.t('inspector.title') })).toBeVisible({
      timeout: 15_000,
    });

    const exposedGlobals = await page.evaluate(() => ({
      framework: typeof window.framework,
      nodeRequire: typeof Reflect.get(window, 'require'),
      process: typeof Reflect.get(window, 'process'),
    }));
    expect(exposedGlobals).toEqual({
      framework: 'object',
      nodeRequire: 'undefined',
      process: 'undefined',
    });

    const aboutButton = page.getByRole('button', { name: i18n.t('app.about') });
    await aboutButton.focus();
    await expect(aboutButton).toBeFocused();
    await aboutButton.press('Enter');
    await expect(page.getByRole('dialog', { name: 'FRC Framework' })).toBeVisible();
    await page.getByRole('button', { name: i18n.t('app.done') }).click();
    await expect(page.getByRole('dialog', { name: 'FRC Framework' })).toBeHidden();

    await page
      .getByRole('navigation', { name: i18n.t('nav.workspace') })
      .getByText(i18n.t('nav.settings'), { exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: i18n.t('settings.title') })).toBeVisible();
    const language = page.getByRole('combobox', { name: i18n.t('settings.language') });
    await language.click();
    await page.getByRole('option', { name: i18n.t('settings.languageChinese') }).click();
    i18n.setLocale('zh-CN');
    const artifactDirectory = path.resolve('output/playwright');
    await mkdir(artifactDirectory, { recursive: true });
    await page.getByRole('button', { name: i18n.t('app.done') }).click();
    await page.screenshot({
      animations: 'disabled',
      fullPage: true,
      path: path.join(artifactDirectory, 'desktop-shell-zh-CN.png'),
    });

    await page
      .getByRole('navigation', { name: i18n.t('nav.workspace') })
      .getByText(i18n.t('nav.settings'), { exact: true })
      .click();
    const englishLanguage = page.getByRole('combobox', { name: i18n.t('settings.language') });
    await englishLanguage.click();
    await page.getByRole('option', { name: 'English' }).click();
    i18n.setLocale('en');
    await expect(page.getByRole('dialog', { name: i18n.t('settings.title') })).toBeVisible();
    await page.getByRole('button', { name: i18n.t('app.done') }).click();
    await expect(page.getByRole('navigation', { name: i18n.t('nav.workspace') })).toBeVisible();

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const transitionDuration = await page
      .getByRole('button', { name: i18n.t('app.about') })
      .evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(['0s', '0.00001s']).toContain(transitionDuration);

    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'no-preference' });
    await expect(page.getByRole('navigation', { name: i18n.t('nav.workspace') })).toBeVisible();
    await expect(page.getByRole('button', { name: i18n.t('home.choose') })).toBeVisible();

    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setContentSize(1280, 720);
      window?.webContents.setZoomFactor(1.5);
    });
    await expect(page.getByRole('main')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setContentSize(1920, 1080);
      window?.webContents.setZoomFactor(1);
    });
    await page.emulateMedia({ forcedColors: 'none' });
    await expect(
      page.getByRole('complementary', { name: i18n.t('inspector.title') }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await dragHorizontalHandle(page, '.resize-left', 440);
    await expect
      .poll(() =>
        page.locator('frc-framework-app').evaluate((element) => {
          const shell = element as HTMLElement & { layout?: { leftPanelWidth?: number } };
          return shell.layout?.leftPanelWidth;
        }),
      )
      .toBeGreaterThanOrEqual(560);
    await dragHorizontalHandle(page, '.resize-left', -400);

    await dragHorizontalHandle(page, '.resize-inspector', -440);
    await expect
      .poll(() =>
        page.locator('frc-framework-app').evaluate((element) => {
          const shell = element as HTMLElement & { layout?: { inspectorWidth?: number } };
          return shell.layout?.inspectorWidth;
        }),
      )
      .toBeGreaterThanOrEqual(640);
    await dragHorizontalHandle(page, '.resize-inspector', 440);

    await page.screenshot({
      animations: 'disabled',
      fullPage: true,
      path: path.join(artifactDirectory, 'desktop-shell-en.png'),
    });

    const accessibilitySession = await page.context().newCDPSession(page);
    const accessibility = await accessibilitySession.send('Accessibility.getFullAXTree');
    const namedRoles = new Set(['button', 'checkbox', 'combobox', 'link', 'switch', 'textbox']);
    expect(
      accessibility.nodes
        .filter(
          (node) =>
            namedRoles.has(node.role?.value ?? '') && (node.name?.value ?? '').trim().length === 0,
        )
        .map((node) => ({ backendDOMNodeId: node.backendDOMNodeId, role: node.role?.value })),
    ).toEqual([]);

    await application.evaluate(async ({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
    }, projectRoot);
    await page.getByRole('button', { name: i18n.t('home.choose') }).click();
    const createDialog = page.getByRole('dialog', { name: i18n.t('create.title') });
    await expect(createDialog).toBeVisible();
    const createFields = page.locator('#create-dialog md-outlined-text-field');
    await setMaterialField(createFields.nth(0), 'E2E Robot');
    await setMaterialField(createFields.nth(1), '10541');
    await setMaterialField(createFields.nth(2), 'frc.robot.e2e');
    await clickMaterialButton(page, page.locator('#create-dialog md-filled-button'));
    await expect(createDialog).toBeHidden({ timeout: 60_000 });
    await page
      .locator('frc-framework-app')
      .evaluate(
        async (element) =>
          (element as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete,
      );
    const createdState = await page.locator('frc-framework-app').evaluate((element) => {
      const shell = element as HTMLElement & {
        activePage?: string;
        notice?: string;
        noticeError?: boolean;
        project?: { model?: { project?: { displayName?: string } }; path?: string };
      };
      return {
        activePage: shell.activePage,
        displayName: shell.project?.model?.project?.displayName,
        notice: shell.notice,
        noticeError: shell.noticeError,
        path: shell.project?.path,
      };
    });
    expect(createdState).toMatchObject({
      activePage: 'project',
      displayName: 'E2E Robot',
      noticeError: false,
      path: projectRoot,
    });
    expect(await page.getByRole('main').innerText()).toContain(i18n.t('structured.title'));

    const commandSource = path.join(projectRoot, 'src/main/java/frc/robot/e2e/commands');
    const autoSource = path.join(projectRoot, 'src/main/java/frc/robot/e2e/auto');
    await mkdir(commandSource, { recursive: true });
    await mkdir(autoSource, { recursive: true });
    await writeFile(
      path.join(commandSource, 'TeamCommands.java'),
      `package frc.robot.e2e.commands;
       import edu.wpi.first.wpilibj2.command.Command;
       public final class TeamCommands { public static Command flash() { return null; } }
      `,
      'utf8',
    );
    await writeFile(
      path.join(autoSource, 'CompetitionAutos.java'),
      `package frc.robot.e2e.auto;
       import edu.wpi.first.wpilibj2.command.Command;
       public final class CompetitionAutos {
         public static Command centerAuto() { return null; }
       }
      `,
      'utf8',
    );
    const pathplannerSource = path.join(
      projectRoot,
      'src/main/deploy/pathplanner/paths/Center.path',
    );
    await mkdir(path.dirname(pathplannerSource), { recursive: true });
    await writeFile(pathplannerSource, '{}\n', 'utf8');
    const modelAsset = path.join(projectRoot, 'ascope_assets/robot.glb');
    await mkdir(path.dirname(modelAsset), { recursive: true });
    await writeFile(modelAsset, new Uint8Array([0x67, 0x6c, 0x54, 0x46]));
    await clickMaterialButton(
      page,
      page
        .getByRole('navigation', { name: i18n.t('nav.workspace') })
        .locator('md-list-item')
        .filter({ hasText: i18n.t('nav.commands') }),
    );
    await expect(
      page.getByRole('main').getByRole('strong').filter({ hasText: 'flash()' }),
    ).toBeVisible({
      timeout: 15_000,
    });
    const importedCommandTreeItem = page.getByRole('treeitem', { name: 'flash() command' });
    await expect(importedCommandTreeItem).toBeVisible();
    await expect(importedCommandTreeItem.locator('md-icon').nth(1)).toHaveText('play_arrow');
    const importedCommandRow = page
      .getByRole('main')
      .locator('.hierarchy-row')
      .filter({ hasText: 'flash()' });
    await expect(importedCommandRow).toContainText(i18n.t('structured.importedReadOnly'));
    await expect(
      importedCommandRow.getByRole('button', { name: i18n.t('tree.delete') }),
    ).toHaveCount(0);
    await clickMaterialButton(
      page,
      page
        .getByRole('navigation', { name: i18n.t('nav.workspace') })
        .locator('md-list-item')
        .filter({ hasText: i18n.t('nav.auto') }),
    );
    await expect(
      page.getByRole('main').getByRole('strong').filter({ hasText: 'centerAuto()' }),
    ).toBeVisible();
    await waitForExternalSync(page);
    await expect
      .poll(() =>
        page.locator('frc-framework-app').evaluate((element) => {
          const shell = element as HTMLElement & {
            project?: {
              sourceFiles?: readonly {
                binary?: boolean;
                kind?: string;
                path?: string;
              }[];
            };
          };
          return shell.project?.sourceFiles
            ?.filter((file) =>
              ['ascope_assets/robot.glb', 'src/main/deploy/pathplanner/paths/Center.path'].includes(
                file.path ?? '',
              ),
            )
            .map((file) => ({ binary: file.binary, kind: file.kind, path: file.path }));
        }),
      )
      .toEqual([
        { binary: true, kind: 'asset', path: 'ascope_assets/robot.glb' },
        {
          binary: false,
          kind: 'pathplanner',
          path: 'src/main/deploy/pathplanner/paths/Center.path',
        },
      ]);

    await page.getByRole('button', { exact: true, name: i18n.t('tree.source') }).click();
    const sourceSearch = page.locator('md-outlined-text-field.tree-search');
    await setMaterialField(sourceSearch, 'Center.path');
    await page.getByRole('treeitem', { name: /Center\.path/u }).click();
    await expect(page.getByRole('button', { name: i18n.t('inspector.addImport') })).toHaveCount(0);
    await setMaterialField(sourceSearch, 'TeamCommands.java');
    await page.getByRole('treeitem', { name: /TeamCommands\.java/u }).click();
    await expect(page.getByRole('button', { name: i18n.t('inspector.addImport') })).toBeVisible();
    await page.getByRole('button', { exact: true, name: i18n.t('tree.logic') }).click();

    await page
      .getByRole('navigation', { name: i18n.t('nav.workspace') })
      .getByText(i18n.t('nav.settings'), { exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: i18n.t('settings.externalTools') }),
    ).toBeVisible();
    const reviewChangesSwitch = page.getByRole('switch', {
      name: i18n.t('workspace.preview'),
    });
    expect(
      await page.locator('frc-framework-app').evaluate((element) => {
        const shell = element as HTMLElement & { settings?: { previewChanges?: boolean } };
        return shell.settings?.previewChanges;
      }),
    ).toBe(false);
    await clickMaterialButton(page, reviewChangesSwitch);
    await expect
      .poll(() =>
        page.locator('frc-framework-app').evaluate((element) => {
          const shell = element as HTMLElement & { settings?: { previewChanges?: boolean } };
          return shell.settings?.previewChanges;
        }),
      )
      .toBe(true);
    expect(
      await page.locator('frc-framework-app').evaluate((element) => {
        const shell = element as HTMLElement & {
          settings?: { externalTools?: { pathplanner?: { mode?: string } } };
        };
        return shell.settings?.externalTools?.pathplanner?.mode;
      }),
    ).toBe('auto');
    await setMaterialField(
      page.locator('[data-settings-field="editorExecutable"]'),
      electronExecutable,
    );
    await clickMaterialButton(
      page,
      page
        .locator('#settings-dialog md-outlined-button')
        .filter({ hasText: i18n.t('settings.saveCustomEditor') }),
    );
    await expect
      .poll(() =>
        page.locator('frc-framework-app').evaluate((element) => {
          const shell = element as HTMLElement & {
            customEditorExecutable?: string;
            notice?: string;
            noticeError?: boolean;
            settings?: { editor?: { id?: string } };
          };
          return {
            editorId: shell.settings?.editor?.id,
            executable: shell.customEditorExecutable,
            notice: shell.notice,
            noticeError: shell.noticeError,
          };
        }),
      )
      .toMatchObject({ editorId: 'custom', noticeError: false });
    const projectEditor = page.locator('[data-settings-field="projectEditor"]');
    await expect(
      projectEditor
        .locator('md-select-option')
        .filter({ hasText: i18n.t('settings.customEditor') }),
    ).toHaveCount(1);
    await setMaterialSelect(projectEditor, 'custom');
    await expect
      .poll(() =>
        page.locator('frc-framework-app').evaluate((element, root) => {
          const shell = element as HTMLElement & {
            settings?: { projectEditors?: Record<string, string> };
          };
          return shell.settings?.projectEditors?.[root];
        }, projectRoot),
      )
      .toBe('custom');
    const editorState = await page.locator('frc-framework-app').evaluate((element, root) => {
      const shell = element as HTMLElement & {
        preview?: unknown;
        project?: { model?: { project?: { editorId?: string } } };
        settings?: { projectEditors?: Record<string, string> };
      };
      return {
        localEditor: shell.settings?.projectEditors?.[root],
        modelEditor: shell.project?.model?.project?.editorId,
        preview: shell.preview,
      };
    }, projectRoot);
    expect(editorState).toEqual({
      localEditor: 'custom',
      modelEditor: undefined,
      preview: undefined,
    });
    const settingsDialog = page.locator('#settings-dialog');
    await clickMaterialButton(
      page,
      settingsDialog.locator('md-filled-button').filter({ hasText: i18n.t('app.done') }),
    );
    await expect(settingsDialog).toBeHidden();

    await clickMaterialButton(
      page,
      page
        .getByRole('navigation', { name: i18n.t('nav.workspace') })
        .locator('md-list-item')
        .filter({ hasText: i18n.t('nav.project') }),
    );

    await page.getByRole('button', { name: i18n.t('structured.addSubsystem') }).click();
    const subsystemDialog = page.getByRole('dialog', {
      name: i18n.t('structured.addSubsystem'),
    });
    await expect(subsystemDialog).toBeVisible();
    await setMaterialField(
      page.locator('#subsystem-dialog md-outlined-text-field').nth(0),
      'Intake',
    );
    await expect(page.locator('#subsystem-dialog .workspace-card .path')).toHaveText(
      'src/main/java/frc/robot/e2e/subsystems/intake/Intake.java',
    );
    await expect(subsystemDialog.getByLabel(i18n.t('structured.javaPackage'))).toHaveCount(0);
    await clickMaterialButton(page, page.locator('#subsystem-dialog md-filled-button'));
    await expect(subsystemDialog).toBeHidden();
    await expect(page.getByText(i18n.t('diff.pending'), { exact: true })).toBeVisible();
    const pendingSelection = await page
      .locator('frc-framework-app')
      .evaluate(
        (element) => (element as HTMLElement & { selectedEntityId?: string }).selectedEntityId,
      );

    await page
      .getByRole('main')
      .getByRole('button', { name: i18n.t('structured.addSubsystem') })
      .click();
    await expect(subsystemDialog).toBeVisible();
    await setMaterialField(
      page.locator('#subsystem-dialog md-outlined-text-field').nth(0),
      'Blocked while previewing',
    );
    await clickMaterialButton(page, page.locator('#subsystem-dialog md-filled-button'));
    await expect(subsystemDialog).toBeHidden();
    await expect(page.getByText(i18n.t('diff.resolvePending'), { exact: true })).toBeVisible();
    await expect(page.getByText(i18n.t('diff.pending'), { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('frc-framework-app')
          .evaluate(
            (element) => (element as HTMLElement & { selectedEntityId?: string }).selectedEntityId,
          ),
      )
      .toBe(pendingSelection);

    await page.getByRole('button', { name: i18n.t('diff.apply') }).click();
    await expect(page.getByText(i18n.t('diff.pending'), { exact: true })).toBeHidden({
      timeout: 60_000,
    });
    await waitForExternalSync(page);
    await expect(page.getByRole('button', { name: 'Intake direct' })).toBeVisible();

    await page
      .getByRole('main')
      .getByRole('button', { name: i18n.t('structured.addSubsystem') })
      .click();
    await setMaterialField(
      page.locator('#subsystem-dialog md-outlined-text-field').first(),
      'Pivot Helpers',
    );
    await setMaterialSelect(page.locator('#subsystem-dialog md-outlined-select').nth(1), 'group');
    await expect(page.locator('#subsystem-dialog .workspace-card .path')).toHaveText(
      'src/main/java/frc/robot/e2e/subsystems/intake/pivotHelpers/PivotHelpers.java',
    );
    await clickMaterialButton(page, page.locator('#subsystem-dialog md-text-button'));
    await expect(subsystemDialog).toBeHidden();

    const inspector = page.getByRole('complementary', { name: i18n.t('inspector.title') });
    await setMaterialFieldAndCommit(
      inspector.locator('md-outlined-text-field').first(),
      'Collector Intake',
    );
    await expect(page.getByText(i18n.t('diff.pending'), { exact: true })).toBeVisible();
    await expect(inspector.locator('.path').first()).toHaveText(
      'src/main/java/frc/robot/e2e/subsystems/collectorIntake/CollectorIntake.java',
    );
    await page.getByRole('button', { name: i18n.t('diff.apply') }).click();
    await expect(page.getByText(i18n.t('diff.pending'), { exact: true })).toBeHidden({
      timeout: 60_000,
    });
    await waitForExternalSync(page);
    await expect(page.getByRole('button', { name: 'Collector Intake direct' })).toBeVisible();

    await clickMaterialButton(
      page,
      page
        .getByRole('navigation', { name: i18n.t('nav.workspace') })
        .locator('md-list-item')
        .filter({ hasText: i18n.t('nav.presets') }),
    );
    await page.getByRole('button', { name: i18n.t('presets.add') }).click();
    const presetDialog = page.getByRole('dialog', { name: i18n.t('presets.add') });
    await expect(presetDialog).toBeVisible();
    await setMaterialSelect(
      page.locator('#preset-dialog md-outlined-select').first(),
      'frc.percent-output',
    );
    await setMaterialField(page.locator('#preset-dialog md-outlined-text-field').first(), 'Roller');
    await clickMaterialButton(page, page.locator('#preset-dialog md-filled-button'));
    await expect(presetDialog).toBeHidden();
    await expect(page.getByText(i18n.t('diff.pending'), { exact: true })).toBeVisible();
    await page.getByRole('button', { name: i18n.t('diff.apply') }).click();
    await expect(page.getByText(i18n.t('diff.pending'), { exact: true })).toBeHidden({
      timeout: 60_000,
    });
    await waitForExternalSync(page);
    const rollerSubsystem = page.getByRole('treeitem', { name: 'Roller mechanism' });
    await expect(rollerSubsystem).toBeVisible({ timeout: 15_000 });
    const rollerMotor = page.getByRole('treeitem', { name: 'Roller Motor motor' });
    if (!(await rollerMotor.isVisible())) {
      await rollerSubsystem.evaluate((element) => (element as HTMLElement).click());
    }
    await expect(rollerMotor).toBeVisible();
    await expect(rollerMotor.locator('md-icon').nth(1)).toHaveText('electric_bolt');
    expect(await rollerMotor.locator('md-icon').nth(1).textContent()).not.toBe('play_arrow');
    const rollerMotorId = await rollerMotor.getAttribute('data-entity-id');
    expect(rollerMotorId).not.toBeNull();
    await rollerMotor.evaluate((element) => (element as HTMLElement).click());
    await expect
      .poll(() =>
        page.locator('frc-framework-app').evaluate((element) => {
          const shell = element as HTMLElement & { selectedEntityId?: string };
          return shell.selectedEntityId;
        }),
      )
      .toBe(rollerMotorId);
    const firstNtChip = page.locator('.parameter-row md-filter-chip').first();
    await expect(firstNtChip).toBeVisible();
    expect(
      await firstNtChip.evaluate(
        (element) => (element as HTMLElement & { selected: boolean }).selected,
      ),
    ).toBe(true);
    await clickMaterialButton(page, firstNtChip);
    await expect(page.getByText(i18n.t('diff.pending'), { exact: true })).toBeVisible();
    await page.getByRole('button', { name: i18n.t('diff.apply') }).click();
    await expect(page.getByText(i18n.t('diff.pending'), { exact: true })).toBeHidden({
      timeout: 60_000,
    });
    // Applying regenerates source files and may briefly rebuild the tree from a
    // file-watcher event. Reselect the same stable entity before checking that
    // the Inspector reflects the persisted NetworkTables setting.
    await expect(rollerMotor).toBeVisible();
    await rollerMotor.evaluate((element) => (element as HTMLElement).click());
    await expect
      .poll(() =>
        page.locator('frc-framework-app').evaluate((element) => {
          const shell = element as HTMLElement & { selectedEntityId?: string };
          return shell.selectedEntityId;
        }),
      )
      .toBe(rollerMotorId);
    await expect(firstNtChip).toBeVisible();
    expect(
      await firstNtChip.evaluate(
        (element) => (element as HTMLElement & { selected: boolean }).selected,
      ),
    ).toBe(false);

    await rollerSubsystem.evaluate((element) =>
      element.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, button: 2, composed: true }),
      ),
    );
    await clickMaterialButton(
      page,
      page.locator('#tree-actions-menu md-menu-item').filter({ hasText: i18n.t('tree.delete') }),
    );
    const deleteDialog = page.getByRole('dialog', { name: i18n.t('tree.deleteTitle') });
    await expect(deleteDialog).toBeVisible();
    await expect(page.locator('#delete-impact-dialog')).toContainText('Roller Motor');
    await clickMaterialButton(page, page.locator('#delete-impact-dialog md-filled-button'));
    await expect(page.getByText(i18n.t('diff.pending'), { exact: true })).toBeVisible();
    await page.getByRole('button', { name: i18n.t('diff.apply') }).click();
    await expect(page.getByText(i18n.t('diff.pending'), { exact: true })).toBeHidden({
      timeout: 60_000,
    });
    await waitForExternalSync(page);
    await expect(rollerSubsystem).toBeHidden();

    await clickMaterialButton(
      page,
      page
        .getByRole('navigation', { name: i18n.t('nav.workspace') })
        .locator('md-list-item')
        .filter({ hasText: i18n.t('nav.toolchain') }),
    );
    await expect(page.getByRole('heading', { name: i18n.t('toolchain.title') })).toBeVisible();
    const compileButton = page
      .locator('md-filled-tonal-button')
      .filter({ hasText: i18n.t('toolchain.compile') });
    await expect(compileButton).toBeVisible();
    await clickMaterialButton(page, compileButton);
    await expect(page.locator('pre.task-output')).not.toHaveText(i18n.t('toolchain.noOutput'), {
      timeout: 30_000,
    });
  } finally {
    await application.close();
    await rm(userData, { force: true, recursive: true });
  }
});

async function setMaterialField(field: Locator, value: string): Promise<void> {
  await field.evaluate((element, nextValue) => {
    const materialField = element as HTMLElement & { value: string };
    materialField.value = nextValue;
    materialField.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }, value);
}

async function setMaterialFieldAndCommit(field: Locator, value: string): Promise<void> {
  await field.evaluate((element, nextValue) => {
    const materialField = element as HTMLElement & { value: string };
    materialField.value = nextValue;
    materialField.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    materialField.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }, value);
}

async function setMaterialSelect(select: Locator, value: string): Promise<void> {
  await select.evaluate((element, nextValue) => {
    const materialSelect = element as HTMLElement & { value: string };
    materialSelect.value = nextValue;
    materialSelect.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }, value);
}

async function clickMaterialButton(_page: Page, button: Locator): Promise<void> {
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeVisible();
  await button.evaluate((element) => (element as HTMLElement).click());
}

async function dragHorizontalHandle(
  page: Page,
  selector: '.resize-inspector' | '.resize-left',
  deltaX: number,
): Promise<void> {
  const handle = page.locator(selector);
  await expect(handle).toBeVisible();
  const bounds = await handle.boundingBox();
  if (bounds === null) throw new Error(`Resize handle ${selector} has no bounds.`);
  const startX = bounds.x + bounds.width / 2;
  const startY = bounds.y + Math.min(40, bounds.height / 2);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 8 });
  await page.mouse.up();
}

async function waitForExternalSync(page: Page): Promise<void> {
  // The renderer intentionally debounces filesystem events. Wait for one full
  // watcher cycle before asserting that generated writes were not classified
  // as unresolved external edits.
  await page.waitForTimeout(400);
  await expect
    .poll(() =>
      page.locator('frc-framework-app').evaluate((element) => {
        const shell = element as HTMLElement & { externalChanges?: readonly unknown[] };
        return shell.externalChanges?.length ?? 0;
      }),
    )
    .toBe(0);
  await expect(page.locator('#external-change-dialog')).toBeHidden();
}
