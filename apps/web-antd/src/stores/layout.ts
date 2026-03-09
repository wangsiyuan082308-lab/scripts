import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useLayoutStore = defineStore('layout', () => {
  const searchHeight = ref(0);

  function setSearchHeight(height: number) {
    searchHeight.value = height;
  }

  return {
    searchHeight,
    setSearchHeight,
  };
});
