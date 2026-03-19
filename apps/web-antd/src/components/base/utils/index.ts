import { cloneDeep, isEqual } from 'lodash-es';

// RenderDom
import { h } from 'vue';

export const RenderDom = {
  name: 'RenderDom',
  functional: true,
  props: {
    render: Function,
    props: [Object, String],
  },
  render: (ctx: any) => {
    return ctx.render && ctx.render(h, ctx.props);
  },
};

// getPropByPath
export function getPropByPath(
  obj: any,
  path: string,
  strict: boolean,
): {
  k: string;
  o: unknown;
  v: unknown;
} {
  let tempObj = obj;
  path = path.replaceAll(/\[(\w+)\]/g, '.$1');
  path = path.replace(/^\./, '');

  const keyArr = path.split('.');
  let i = 0;
  for (i; i < keyArr.length - 1; i++) {
    if (!tempObj && !strict) break;
    const key = keyArr[i]!;

    if (key in tempObj) {
      tempObj = tempObj[key];
    } else {
      if (strict) {
        throw new Error('please transfer a valid prop path to form item!');
      }
      break;
    }
  }
  return {
    o: tempObj,
    k: keyArr[i]!,
    v: tempObj?.[keyArr[i]!],
  };
}

// isType
export function isType(val: any, type: string) {
  const typeArr = ['String', 'Array', 'Number', 'Object', 'Null', 'Undefined'];
  if (!typeArr.includes(type)) {
    console.warn('isType 类型错误');
    return false;
  }
  return Object.prototype.toString.call(val) === `[object ${type}]`;
}

// isDef
export function isDef(val: any) {
  return !(isType(val, 'Null') || isType(val, 'Undefined'));
}

// trim
export function trim(str: any, type?: number) {
  if (typeof str === 'string') {
    type = type || 1;
    switch (type) {
      case 1: {
        return str.replaceAll(/\s+/g, '');
      }
      case 2: {
        return /^\s+$/.test(str)
          ? str.replaceAll(/\s+/g, '')
          : str.replaceAll(/(^\s*)|(\s*$)/g, '');
      }
      case 3: {
        return str.replaceAll(/(^\s*)/g, '');
      }
      case 4: {
        return str.replaceAll(/(\s*$)/g, '');
      }
      default: {
        return str;
      }
    }
  }
  return str;
}

// getDate
export function getDate(
  days: number,
  startDate?: string,
  format = '{y}-{m}-{d}',
) {
  const date = startDate ? new Date(startDate) : new Date();
  date.setDate(date.getDate() + days);
  return parseTime(date, format);
}

// parseTime
export function parseTime(
  time: Date | number,
  cFormat?: string,
): string | undefined {
  if (arguments.length === 0) {
    return undefined;
  }
  const format = cFormat || '{y}-{m}-{d} {h}:{i}:{s}';
  let date: Date;
  if (typeof time === 'object') {
    date = time;
  } else {
    if (`${time}`.length === 10) time = Number.parseInt(time.toString()) * 1000;
    date = new Date(time);
  }
  const formatObj: Record<string, number> = {
    y: date.getFullYear(),
    m: date.getMonth() + 1,
    d: date.getDate(),
    h: date.getHours(),
    i: date.getMinutes(),
    s: date.getSeconds(),
    a: date.getDay(),
  };
  const time_str = format.replaceAll(
    /\{([ymdhisa])+\}/g,
    (result: string, key: string): string => {
      let value: number | string = formatObj[key] ?? 0;
      // Note: getDay() returns 0 on Sunday
      if (key === 'a') {
        return ['日', '一', '二', '三', '四', '五', '六'][value as number] ?? '';
      }
      if (result.length > 0 && (value as number) < 10) {
        value = `0${value}`;
      }
      return (value || 0).toString();
    },
  );
  return time_str;
}

export { cloneDeep, isEqual };
