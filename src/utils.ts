export function get(obj: any, path: string): any {
  if (!path) return obj;
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

export function set(obj: Record<string, any>, path: string, value: any): void {
  const keys = path.split(".");
  const last = keys.pop()!;

  const target = keys.reduce((acc, key) => {
    if (
      acc[key] === undefined ||
      acc[key] === null ||
      typeof acc[key] !== "object"
    ) {
      acc[key] = {};
    }
    return acc[key];
  }, obj);

  target[last] = value;
}

export function unset(obj: Record<string, any>, path: string): void {
  const keys = path.split(".");
  const last = keys.pop()!;

  const target = keys.reduce((acc, key) => acc?.[key], obj);

  if (target && typeof target === "object") {
    delete target[last];
  }
}

export function flatKeys(obj: Record<string, any>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, val]) => {
    const path = prefix ? `${prefix}.${key}` : key;

    return val && typeof val === "object" && !Array.isArray(val) && val !== null
      ? flatKeys(val, path)
      : [path];
  });
}
