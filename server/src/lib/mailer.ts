import nodemailer, { type Transporter } from 'nodemailer';
import type { Logger } from 'pino';
import { env } from '../config/env.js';
import { logger as defaultLogger } from './logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export type MailResult = { ok: true; messageId: string } | { ok: false; error: string };

/** The only part of a Nodemailer transport we depend on (lets tests inject a stub). */
export interface MailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    replyTo?: string;
  }): Promise<{ messageId?: string }>;
}

let transport: MailTransport | undefined;

function getTransport(): MailTransport {
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } } : {}),
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  }) as Transporter as MailTransport;
  return transport;
}

/** Tests only: replace the SMTP transport (pass undefined to restore the real one). */
export function setMailTransportForTests(t: MailTransport | undefined): void {
  transport = t;
}

/**
 * Sends one email. NEVER throws (NFR-17): callers inspect the result and record SENT/FAILED.
 * Failures are logged with the subject only (no recipient: personal data), never the body.
 *
 * Caller rules: escape any user-supplied data you put in `html`; never put tokens or links in
 * `subject` (subject and `to` are logged on failure, NFR-06) - keep them in the body.
 */
export async function sendMail(message: MailMessage, log: Logger = defaultLogger): Promise<MailResult> {
  try {
    const info = await getTransport().sendMail({
      from: env.SMTP_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });
    return { ok: true, messageId: String(info?.messageId ?? '') };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown mail error';
    log.warn({ subject: message.subject, error }, 'Email delivery failed');
    return { ok: false, error };
  }
}
