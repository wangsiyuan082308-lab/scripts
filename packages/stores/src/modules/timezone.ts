import { ref, unref } from 'vue';

import { DEFAULT_TIME_ZONE_OPTIONS } from '@vben-core/preferences';
import {
  getCurrentTimezone,
  setCurrentTimezone,
} from '@vben-core/shared/utils';

import { acceptHMRUpdate, defineStore } from 'pinia';

interface TimezoneHandler {
  getTimezone?: () => Promise<null | string | undefined>;
  getTimezoneOptions?: () => Promise<
    {
      label: string;
      value: string;
    }[]
  >;
  setTimezone?: (timezone: string) => Promise<void>;
}

/**
 * 默认时区处理模块
 * 时区存储基于pinia存储插件
 */
const getDefaultTimezoneHandler = (): TimezoneHandler => {
  return {
    getTimezoneOptions: () => {
      return Promise.resolve(
        DEFAULT_TIME_ZONE_OPTIONS.map((item) => {
          return {
            label: item.label,
            value: item.timezone,
          };
        }),
      );
    },
  };
};

/**
 * 自定义时区处理模块
 */
let customTimezoneHandler: null | Partial<TimezoneHandler> = null;

/**
 * 注册业务侧自定义的时区读写实现。
 */
const setTimezoneHandler = (handler: Partial<TimezoneHandler>) => {
  customTimezoneHandler = handler;
};

/**
 * 获取时区处理模块
 * @description 默认实现与业务自定义实现合并后返回，业务实现优先级更高。
 */
const getTimezoneHandler = () => {
  return {
    ...getDefaultTimezoneHandler(),
    ...customTimezoneHandler,
  };
};

/**
 * timezone支持模块
 * @description 负责初始化、切换和持久化当前应用时区。
 */
const useTimezoneStore = defineStore(
  'core-timezone',
  () => {
    const timezoneRef = ref(getCurrentTimezone());

    /**
     * 初始化时区
     * Initialize the timezone
     */
    async function initTimezone() {
      const timezoneHandler = getTimezoneHandler();
      const timezone = await timezoneHandler.getTimezone?.();
      if (timezone) {
        timezoneRef.value = timezone;
      }
      // 设置dayjs默认时区
      setCurrentTimezone(unref(timezoneRef));
    }

    /**
     * 设置时区
     * Set the timezone
     * @param timezone 时区字符串
     */
    async function setTimezone(timezone: string) {
      const timezoneHandler = getTimezoneHandler();
      await timezoneHandler.setTimezone?.(timezone);
      timezoneRef.value = timezone;
      // 设置dayjs默认时区
      setCurrentTimezone(timezone);
    }

    /**
     * 获取时区选项
     * Get the timezone options
     */
    async function getTimezoneOptions() {
      const timezoneHandler = getTimezoneHandler();
      return (await timezoneHandler.getTimezoneOptions?.()) || [];
    }

    initTimezone().catch((error) => {
      console.error('Failed to initialize timezone during store setup:', error);
    });

    function $reset() {
      timezoneRef.value = getCurrentTimezone();
    }

    return {
      timezone: timezoneRef,
      setTimezone,
      getTimezoneOptions,
      $reset,
    };
  },
  {
    persist: {
      // 持久化
      pick: ['timezone'],
    },
  },
);

export { setTimezoneHandler, useTimezoneStore };

// 解决热更新问题
const hot = import.meta.hot;
if (hot) {
  hot.accept(acceptHMRUpdate(useTimezoneStore, hot));
}
