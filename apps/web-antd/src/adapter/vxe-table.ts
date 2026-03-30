import { setupVbenVxeTable } from '@vben/plugins/vxe-table';
import { useVbenForm } from './form';

export async function initVxeTable() {
  setupVbenVxeTable({
    configVxeTable: (VxeUI) => {
      // Global configuration for VxeTable
      VxeUI.setConfig({
        grid: {
          proxyConfig: {
            autoLoad: true,
            message: true,
            props: {
              result: 'items',
              total: 'total',
            },
          },
        },
      });
    },
    useVbenForm,
  });
}
