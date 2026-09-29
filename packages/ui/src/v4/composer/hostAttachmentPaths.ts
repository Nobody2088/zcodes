function pathSeparator(path: string): string {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

export function parentPath(currentPath: string): string {
  const separator = pathSeparator(currentPath);
  const trimmed = currentPath.replace(/[\\/]+$/u, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index < 0) return currentPath;
  if (index === 0) return separator;
  const parent = trimmed.slice(0, index);
  return /^[A-Za-z]:$/u.test(parent) ? `${parent}\\` : parent;
}

export function isSameOrUnder(path: string, root: string): boolean {
  if (!root) return false;
  if (path === root) return true;
  const separator = pathSeparator(root);
  const prefix = root.endsWith(separator) ? root : `${root}${separator}`;
  return path.startsWith(prefix);
}

/** 主目录已知且当前路径在其下时，停在主目录。主目录未知时仍可向上，直到文件系统根。 */
export function canGoUp(currentPath: string, homePath: string): boolean {
  if (!currentPath || (homePath && currentPath === homePath)) return false;
  const parent = parentPath(currentPath);
  if (parent === currentPath) return false;
  if (homePath && isSameOrUnder(currentPath, homePath)) return isSameOrUnder(parent, homePath);
  return true;
}
