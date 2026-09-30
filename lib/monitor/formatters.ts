const memoryUnits = ["KB", "MB", "GB"] as const;

// 监控接口统一返回 KB，这里集中做单位换算，避免各组件重复实现。
export function formatMemory(kb: number): string {
  let value = kb;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < memoryUnits.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${memoryUnits[unitIndex]}`;
}

// 耗时和内存一样会被多个展示组件使用，格式化规则保持一致。
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatNumber(value: number): string {
  return value.toFixed(1);
}

export function formatTime(isoTime: string): string {
  return new Date(isoTime).toLocaleTimeString("zh-CN", { hour12: false });
}
