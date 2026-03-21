const nodemailer = require('nodemailer');

class SmtpClientWrapper {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass
      }
    });
  }

  async verify() {
    await this.transporter.verify();
  }

  async sendReply({ to, originalSubject, taskType, requestText, executionResult, inReplyTo, references }) {
    const statusLabel = executionResult.success ? '已完成' : '失败';
    const subject = `Re: [${taskType}${statusLabel}] ${originalSubject}`;
    const body = [
      `任务类型: ${taskType}`,
      `原始请求: ${requestText}`,
      '',
      '执行结果:',
      '----------------',
      executionResult.success ? executionResult.output : executionResult.error || 'Unknown error',
      '----------------',
      '',
      '时间:',
      `开始: ${executionResult.startedAt}`,
      `结束: ${executionResult.finishedAt}`,
      `耗时: ${executionResult.durationMs}ms`,
      '',
      '系统:',
      'OpenClaw Mail Worker'
    ].join('\n');

    return this.transporter.sendMail({
      from: this.config.smtp.user,
      to,
      subject,
      text: body,
      inReplyTo,
      references
    });
  }
}

module.exports = {
  SmtpClientWrapper
};
