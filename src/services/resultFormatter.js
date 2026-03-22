function toPrettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function buildSuccessMail({ type, subject, result }) {
  const summary = result && typeof result === 'object' ? (result.message || '任务执行完成。') : '任务执行完成。';
  const text = [
    `您好，`,
    '',
    `您的 ${type} 任务已处理完成。`,
    `原始主题：${subject || '(无主题)'}`,
    `处理摘要：${summary}`,
    '',
    '结果详情：',
    toPrettyJson(result),
    '',
    '此邮件由自动处理 Agent 发送。'
  ].join('\n');

  const html = `
    <p>您好，</p>
    <p>您的 <strong>${type}</strong> 任务已处理完成。</p>
    <p><strong>原始主题：</strong>${subject || '(无主题)'}</p>
    <p><strong>处理摘要：</strong>${summary}</p>
    <p><strong>结果详情：</strong></p>
    <pre>${toPrettyJson(result)}</pre>
    <p>此邮件由自动处理 Agent 发送。</p>
  `;

  return { text, html };
}

function buildFailureMail({ type, subject, error }) {
  const message = error && error.message ? error.message : '未知错误';
  const text = [
    '您好，',
    '',
    `您的 ${type} 任务处理失败。`,
    `原始主题：${subject || '(无主题)'}`,
    `失败原因：${message}`,
    '',
    '请检查输入后重试，或联系管理员排查日志。'
  ].join('\n');

  const html = `
    <p>您好，</p>
    <p>您的 <strong>${type}</strong> 任务处理失败。</p>
    <p><strong>原始主题：</strong>${subject || '(无主题)'}</p>
    <p><strong>失败原因：</strong>${message}</p>
    <p>请检查输入后重试，或联系管理员排查日志。</p>
  `;

  return { text, html };
}

module.exports = {
  buildSuccessMail,
  buildFailureMail
};
