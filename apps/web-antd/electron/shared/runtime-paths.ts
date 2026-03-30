import { app } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const APP_RUNTIME_DIRNAME = '@vben/web-antd';

export function getAppRuntimeRoot() {
  try {
    return app.getPath('userData');
  } catch {
    if (process.platform === 'darwin') {
      return path.join(
        os.homedir(),
        'Library',
        'Application Support',
        APP_RUNTIME_DIRNAME,
      );
    }
    if (process.platform === 'win32') {
      return path.join(
        process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        APP_RUNTIME_DIRNAME,
      );
    }
    return path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
      APP_RUNTIME_DIRNAME,
    );
  }
}

export function ensureRuntimeDir(...segments: string[]) {
  const dirPath = path.join(getAppRuntimeRoot(), ...segments);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}
