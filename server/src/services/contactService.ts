import type { Logger } from 'pino';
import { env } from '../config/env.js';
import { serviceUnavailable } from '../lib/errors.js';
import { sendMail } from '../lib/mailer.js';

export interface ContactInput {
  name: string;
  email: string;
  subject?: string;
  message: string;
  contact_hp?: string;
}

export const CONTACT_SUCCESS = "Thanks! We'll get back to you soon.";

export const contactService = {
  async submit(input: ContactInput, log: Logger): Promise<{ message: string }> {
    // Honeypot: bots fill the hidden field. Pretend success, send nothing.
    if (input.contact_hp) return { message: CONTACT_SUCCESS };

    const text = [
      'New contact form message',
      '',
      `Name: ${input.name}`,
      `Email: ${input.email}`,
      `Subject: ${input.subject || '(none)'}`,
      '',
      'Message:',
      input.message,
    ].join('\n');

    const result = await sendMail(
      { to: env.CONTACT_TO, subject: `[Contact] ${input.subject || 'New message'}`, text, replyTo: input.email },
      log,
    );
    if (!result.ok) {
      throw serviceUnavailable("We couldn't send your message right now. Please try again later.");
    }
    return { message: CONTACT_SUCCESS };
  },
};
