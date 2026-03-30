import type { Directive, DirectiveBinding } from 'vue';

interface ResizeInfo {
  width: number;
  height: number;
  offsetWidth: number;
  offsetHeight: number;
  clientWidth: number;
  clientHeight: number;
}

type ResizeCallback = (size: ResizeInfo) => void;

interface DomChangeElement extends HTMLElement {
  __resizeObserver__?: ResizeObserver;
  __resizeCallback__?: ResizeCallback;
  __lastSize__?: ResizeInfo;
}

/**
 * 获取元素的尺寸信息
 */
function getElementSize(element: HTMLElement): ResizeInfo {
  const rect = element.getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
    offsetWidth: element.offsetWidth,
    offsetHeight: element.offsetHeight,
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
  };
}

/**
 * 检查尺寸是否发生变化
 */
function isSizeChanged(
  oldSize: ResizeInfo | undefined,
  newSize: ResizeInfo,
  modifiers: Partial<Record<string, boolean>>,
): boolean {
  if (!oldSize) return true;

  // 如果有修饰符，只检查特定维度
  if (modifiers.height) {
    return oldSize.height !== newSize.height;
  }
  if (modifiers.width) {
    return oldSize.width !== newSize.width;
  }

  // 默认检查所有尺寸
  return (
    oldSize.width !== newSize.width ||
    oldSize.height !== newSize.height ||
    oldSize.offsetWidth !== newSize.offsetWidth ||
    oldSize.offsetHeight !== newSize.offsetHeight
  );
}

/**
 * 创建 ResizeObserver
 */
function createResizeObserver(
  el: DomChangeElement,
  callback: ResizeCallback,
  modifiers: Partial<Record<string, boolean>>,
) {
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const target = entry.target as HTMLElement;
      const newSize = getElementSize(target);

      // 检查是否真的发生了变化
      if (isSizeChanged(el.__lastSize__, newSize, modifiers)) {
        el.__lastSize__ = newSize;
        callback?.(newSize);
      }
    }
  });

  resizeObserver.observe(el);
  return resizeObserver;
}

/**
 * 清理 ResizeObserver
 */
function cleanup(el: DomChangeElement) {
  if (el.__resizeObserver__) {
    el.__resizeObserver__.disconnect();
    delete el.__resizeObserver__;
    delete el.__resizeCallback__;
    delete el.__lastSize__;
  }
}

/**
 * DOM 变化指令
 */
export const vDomChange: Directive<DomChangeElement, ResizeCallback> = {
  mounted(el: DomChangeElement, binding: DirectiveBinding<ResizeCallback>) {
    const { value: callback, modifiers } = binding;

    if (typeof callback !== 'function') {
      // console.warn('[v-dom-change] 回调函数无效');
      return;
    }

    // 检查浏览器是否支持 ResizeObserver
    if (typeof ResizeObserver === 'undefined') {
      console.warn('[v-dom-change] 浏览器不支持 ResizeObserver');
      return;
    }

    // 保存回调函数
    el.__resizeCallback__ = callback;

    // 创建并启动观察器
    el.__resizeObserver__ = createResizeObserver(el, callback, modifiers);

    // 初始调用一次回调（可选）
    const initialSize = getElementSize(el);
    el.__lastSize__ = initialSize;
    callback(initialSize);
  },

  updated(el: DomChangeElement, binding: DirectiveBinding<ResizeCallback>) {
    const { value: callback, modifiers } = binding;

    // 如果回调函数改变了，更新它
    if (callback !== el.__resizeCallback__) {
      cleanup(el);

      if (typeof callback === 'function') {
        el.__resizeCallback__ = callback;
        el.__resizeObserver__ = createResizeObserver(el, callback, modifiers);

        const initialSize = getElementSize(el);
        el.__lastSize__ = initialSize;
        callback(initialSize);
      }
    }
  },

  unmounted(el: DomChangeElement) {
    cleanup(el);
  },
};

export default vDomChange;
