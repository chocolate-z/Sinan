import { onUnmounted, ref, type ComponentPublicInstance, type Ref } from 'vue';

/** 测量容器宽度(ResizeObserver),供响应式 SVG 图表。
 * 返回回调式 ref(:ref="setEl")+ 宽度;测试/无 RO 环境退化为初始宽。 */
export function useMeasure(initial = 720): {
  setEl: (e: Element | ComponentPublicInstance | null) => void;
  width: Ref<number>;
} {
  const width = ref(initial);
  let ro: ResizeObserver | undefined;
  const setEl = (e: Element | ComponentPublicInstance | null) => {
    ro?.disconnect();
    const node = e instanceof Element ? e : null;
    if (node && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver((entries) => {
        const cw = entries[0]?.contentRect.width;
        if (cw) width.value = cw;
      });
      ro.observe(node);
    }
  };
  onUnmounted(() => ro?.disconnect());
  return { setEl, width };
}
