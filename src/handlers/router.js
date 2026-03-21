const websearchHandler = require('./websearchHandler');
const browserHandler = require('./browserHandler');

const handlers = {
  websearch: websearchHandler,
  browser: browserHandler
};

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        reject(new Error(message));
      }, timeoutMs);
    })
  ]);
}

async function routeTask({ type, timeoutMs, ...context }) {
  const handler = handlers[type];
  if (!handler) {
    throw new Error(`No handler registered for task type: ${type}`);
  }

  return withTimeout(
    Promise.resolve(handler(context)),
    timeoutMs,
    `Task execution timed out after ${timeoutMs}ms for type: ${type}`
  );
}

module.exports = {
  routeTask
};
