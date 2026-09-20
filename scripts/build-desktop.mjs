#!/usr/bin/env node
// Package the remote-site desktop shell without web-server dependencies.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const projectRoot = path.resolve(import.meta.dirname, '..');
const metadata = JSON.parse(
  readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
);
const electron = JSON.parse(
  readFileSync(
    path.join(projectRoot, 'node_modules/electron/package.json'),
    'utf8',
  ),
);
// Keep staging outside the web project's ancestry: electron-builder otherwise
// falls back to collecting the parent package's production dependencies.
const appDirectory = mkdtempSync(
  path.join(os.tmpdir(), 'snoopy-desktop-build-'),
);
cpSync(path.join(projectRoot, 'desktop'), path.join(appDirectory, 'desktop'), {
  recursive: true,
  filter: (source) => path.basename(source) !== 'icon-source.png',
});
writeFileSync(
  path.join(appDirectory, 'package.json'),
  JSON.stringify(
    {
      name: metadata.name,
      version: metadata.version,
      private: true,
      type: metadata.type,
      main: metadata.main,
      description: '스누피가든 업무캘린더 데스크톱 앱',
      dependencies: {},
      build: {
        ...metadata.build,
        electronVersion: electron.version,
        npmRebuild: false,
        directories: {
          output: path.resolve(projectRoot, metadata.build.directories.output),
        },
        win: {
          ...metadata.build.win,
          icon: path.join(projectRoot, metadata.build.win.icon),
        },
      },
    },
    null,
    2,
  ) + '\n',
);
execFileSync(
  process.execPath,
  [
    path.join(projectRoot, 'node_modules/electron-builder/out/cli/cli.js'),
    '--win',
    'portable',
  ],
  { cwd: appDirectory, stdio: 'inherit' },
);
