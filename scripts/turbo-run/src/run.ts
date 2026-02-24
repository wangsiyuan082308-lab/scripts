import { execaCommand, getPackages } from '@vben/node-utils';

import { cancel, isCancel, select } from '@clack/prompts';

interface RunOptions {
  command?: string;
}

export async function run(options: RunOptions) {
  const { command } = options;
  if (!command) {
    console.error('Please enter the command to run');
    process.exit(1);
  }
  const { packages } = await getPackages();

  const selectOptions: {
    label: string;
    value: { command: string; pkgName: string };
  }[] = [];

  packages.forEach((pkg) => {
    const scripts = (pkg?.packageJson as Record<string, any>)?.scripts || {};
    const pkgName = pkg?.packageJson?.name;
    const description = (pkg?.packageJson as Record<string, any>)?.description;
    
    // 构造显示名称：name + description (如果有)
    const displayName = description ? `${pkgName} - ${description}` : pkgName;

    if (scripts[command]) {
      selectOptions.push({
        label: displayName,
        value: { command, pkgName },
      });
    }
    // 检测是否有 electron 命令
    const electronCommand = `${command}:electron`;
    if (scripts[electronCommand]) {
      selectOptions.push({
        label: `${displayName} (Electron)`,
        value: { command: electronCommand, pkgName },
      });
    }
  });

  if (selectOptions.length === 0) {
    console.error('No app found');
    process.exit(1);
  }

  let selectPkg: { command: string; pkgName: string } | symbol;
  if (selectOptions.length > 1) {
    selectPkg = await select({
      message: `Select the app you need to run [${command}]:`,
      options: selectOptions,
    });

    if (isCancel(selectPkg) || !selectPkg) {
      cancel('👋 Has cancelled');
      process.exit(0);
    }
  } else {
    selectPkg = selectOptions[0]?.value as {
      command: string;
      pkgName: string;
    };
  }

  const { command: runCommand, pkgName } = selectPkg as {
    command: string;
    pkgName: string;
  };

  await execaCommand(`pnpm --filter=${pkgName} run ${runCommand}`, {
    stdio: 'inherit',
  });
}
