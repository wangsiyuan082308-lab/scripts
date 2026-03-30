import * as path from 'node:path';

export function isCliEntry(...fileNames: string[]): boolean {
  const entry = process.argv[1];
  if (!entry) return false;

  const normalizedEntry = entry.replaceAll('\\', '/');
  const baseName = path.basename(normalizedEntry);

  return fileNames.some((fileName) => {
    const normalizedFileName = fileName.replaceAll('\\', '/');
    return normalizedEntry.endsWith(normalizedFileName) || baseName === normalizedFileName;
  });
}
