/**
 * 进程级互斥锁 — 向后兼容包装
 *
 * 当前仓库使用本地锁文件实现互斥。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { log } from './utils';

const LOCK_NAME = 'aoixiang-auto-purchase';
const LOCK_DIR = path.join(os.tmpdir(), 'scripts-procurement-locks');

// 兼容旧接口：锁文件路径（外部不应直接依赖，仅供参考）
export const PID_FILE = path.join(LOCK_DIR, `${LOCK_NAME}.pid`);

function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取进程锁。已有实例在运行时返回 false，否则返回 true。
 */
export function acquireProcessLock(): boolean {
  try {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
    if (fs.existsSync(PID_FILE)) {
      const existingPid = Number.parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      if (Number.isFinite(existingPid) && processExists(existingPid)) {
        log(`检测到已有采购实例正在运行（pid=${existingPid}）`);
        return false;
      }
      fs.rmSync(PID_FILE, { force: true });
    }
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
    return true;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    log(message);
    return false;
  }
}

/**
 * 释放进程锁。
 */
export function releaseProcessLock(): void {
  try {
    fs.rmSync(PID_FILE, { force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`释放进程锁失败（忽略）: ${message}`);
  }
}
