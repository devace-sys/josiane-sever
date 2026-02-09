import path from 'path';

/**
 * Safely resolve file path to prevent directory traversal attacks
 * @param baseDir Base directory (absolute path)
 * @param relativePath Relative file path from request
 * @returns Resolved absolute path if safe, null if path traversal detected
 */
export function safeResolveFilePath(baseDir: string, relativePath: string): string | null {
  // Normalize and resolve the full path
  const normalizedBase = path.resolve(baseDir);
  const fullPath = path.resolve(normalizedBase, relativePath.replace(/^\//, ''));
  
  // Ensure the resolved path starts with the base directory
  if (!fullPath.startsWith(normalizedBase)) {
    console.error('[SECURITY] Path traversal attempt detected:', {
      baseDir: normalizedBase,
      relativePath,
      resolvedPath: fullPath,
    });
    return null;
  }
  
  return fullPath;
}

/**
 * Validate file path is within uploads directory
 */
export function validateUploadPath(filePath: string): boolean {
  const uploadsDir = path.resolve(__dirname, '../../uploads');
  const resolvedPath = path.resolve(__dirname, '../../', filePath.replace(/^\//, ''));
  return resolvedPath.startsWith(uploadsDir);
}
