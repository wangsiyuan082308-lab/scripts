import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * 布局 Store。
 * 用于维护页面级布局参数，例如查询区域高度。
 */
export const useLayoutStore = defineStore('layout', () => {
  const searchHeight = ref(0);

  /**
   * 更新查询区域高度，供表格/列表布局联动使用。
   */
  function setSearchHeight(height: number) {
    searchHeight.value = height;
  }

  return {
    searchHeight,
    setSearchHeight,
  };
});
