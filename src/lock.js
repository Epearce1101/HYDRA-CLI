import fs from 'node:fs';

const DEFAULT_STALE_MS = 5000;
const DEFAULT_RETRY_MS = 100;

export async function acquireLock(lockFile, { staleMs = DEFAULT_STALE_MS, retryMs = DEFAULT_RETRY_MS } = {}) {
  while (true) {
    try {
      const fd = fs.openSync(lockFile, 'wx');
      fs.writeFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`, 'utf8');
      fs.closeSync(fd);
      return () => {
        if (fs.existsSync(lockFile)) {
          fs.unlinkSync(lockFile);
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }

      if (isStaleLock(lockFile, staleMs)) {
        try {
          fs.unlinkSync(lockFile);
        } catch (unlinkError) {
          if (unlinkError.code !== 'ENOENT') {
            throw unlinkError;
          }
        }
        continue;
      }

      await delay(retryMs);
    }
  }
}

export async function withLock(lockFile, fn, options) {
  const release = await acquireLock(lockFile, options);
  try {
    return await fn();
  } finally {
    release();
  }
}

function isStaleLock(lockFile, staleMs) {
  try {
    return Date.now() - fs.statSync(lockFile).mtimeMs > staleMs;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
