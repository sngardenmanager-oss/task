#!/usr/bin/env node
// Stage only Android build inputs in an ASCII-only temporary directory.
// Usage: node scripts/build-android.mjs [--release]
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  cpSync,
  copyFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const projectRoot = path.resolve(import.meta.dirname, '..');
const sdkDir =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk');
const jdk21 =
  process.env.JAVA_HOME || 'C:/Program Files/Microsoft/jdk-21.0.12.101-hotspot';
const release = process.argv.includes('--release');
const gradleTask = release ? 'assembleRelease' : 'assembleDebug';
const apkSubpath = release
  ? 'app/build/outputs/apk/release/app-release.apk'
  : 'app/build/outputs/apk/debug/app-debug.apk';

if (!existsSync(sdkDir))
  throw new Error('Android SDK not found. Set ANDROID_HOME.');
if (!existsSync(path.join(jdk21, 'bin', 'java.exe'))) {
  throw new Error('JDK not found. Set JAVA_HOME to a JDK 21 installation.');
}
if (
  release &&
  !existsSync(path.join(projectRoot, 'android', 'keystore.properties'))
) {
  throw new Error('Release signing requires android/keystore.properties.');
}
const temporaryRoot = path.resolve(
  process.env.SNOOPY_ANDROID_TEMP || os.tmpdir(),
);
if (/[^ -~]/.test(temporaryRoot)) {
  throw new Error(
    'Set SNOOPY_ANDROID_TEMP to an ASCII-only temporary directory.',
  );
}
mkdirSync(temporaryRoot, { recursive: true });
const buildRoot = mkdtempSync(
  path.join(temporaryRoot, 'snoopy-android-build-'),
);
console.log('Android staging directory:', buildRoot);

console.log('[1/4] Syncing web assets into android/ via Capacitor...');
execFileSync(
  process.execPath,
  ['node_modules/@capacitor/cli/bin/capacitor', 'sync', 'android'],
  {
    cwd: projectRoot,
    stdio: 'inherit',
  },
);

console.log('[2/4] Staging Android project and native dependencies...');
const excludedDirectories = new Set(['.gradle', 'build', '.idea']);
const copyOptions = {
  recursive: true,
  filter: (source) => !excludedDirectories.has(path.basename(source)),
};
cpSync(
  path.join(projectRoot, 'android'),
  path.join(buildRoot, 'android'),
  copyOptions,
);
cpSync(
  path.join(projectRoot, 'node_modules', '@capacitor', 'android'),
  path.join(buildRoot, 'node_modules', '@capacitor', 'android'),
  copyOptions,
);
writeFileSync(
  path.join(buildRoot, 'android', 'local.properties'),
  'sdk.dir=' + sdkDir.replaceAll('\\', '/') + '\n',
  'utf8',
);

console.log('[3/4] Running Gradle ' + gradleTask + '...');
execFileSync('gradlew.bat', [gradleTask, '--no-daemon'], {
  cwd: path.join(buildRoot, 'android'),
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, JAVA_HOME: jdk21, ANDROID_HOME: sdkDir },
});

console.log('[4/4] Copying APK back into android-dist/...');
const distDir = path.join(projectRoot, 'android-dist');
mkdirSync(distDir, { recursive: true });
const outName = release
  ? '스누피가든-업무캘린더-release.apk'
  : '스누피가든-업무캘린더-debug.apk';
copyFileSync(
  path.join(buildRoot, 'android', apkSubpath),
  path.join(distDir, outName),
);
console.log('Done: android-dist/' + outName);
