function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promiseFactory, timeoutMs, timeoutMessage = 'Execution timed out') {
  const startedAt = Date.now();
  let timeoutHandle;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = new Error(timeoutMessage);
      error.code = 'EXECUTION_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promiseFactory(), timeoutPromise]);
    return {
      result,
      elapsedMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

module.exports = {
  sleep,
  withTimeout
};
