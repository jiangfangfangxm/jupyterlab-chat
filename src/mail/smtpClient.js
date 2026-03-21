const nodemailer = require('nodemailer');

class SmtpClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.transporter = nodemailer.createTransport(config);
  }

  async verify() {
    await this.transporter.verify();
    this.logger.info('SMTP transporter verified successfully');
  }

  async sendReply({ to, subject, text, html, inReplyTo, references }) {
    const info = await this.transporter.sendMail({
      from: this.config.from,
      to,
      subject,
      text,
      html,
      inReplyTo,
      references
    });

    this.logger.info({ messageId: info.messageId, accepted: info.accepted }, 'Reply email sent');
    return info;
  }
}

module.exports = SmtpClient;
