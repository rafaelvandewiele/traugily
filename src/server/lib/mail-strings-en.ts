/** English email template strings (source language). */

export type MailTemplateKey =
  | 'verify_email'
  | 'reset_password'
  | 'welcome'
  | 'payment_success'
  | 'payment_failed'
  | 'subscription_canceled'
  | 'report_ready'
  | 'account_deleted';

export type TemplateStrings = Record<MailTemplateKey, { subject: string; body: string }>;

export const mailStringsEn: TemplateStrings = {
  verify_email: {
    subject: 'Verify your Traugily email',
    body: 'Welcome to Traugily! Please confirm your email address by opening this link: {{link}}\n\nThis link expires in 24 hours. If you did not create an account, you can ignore this email.',
  },
  reset_password: {
    subject: 'Reset your Traugily password',
    body: 'Use this link to choose a new password: {{link}}\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email — your password stays unchanged.',
  },
  welcome: {
    subject: 'Welcome to Traugily',
    body: 'Thanks for joining Traugily! Your training, nutrition and recovery coaching starts with a short onboarding so your plan fits your life.',
  },
  payment_success: {
    subject: 'Your Traugily subscription payment',
    body: 'We received your payment of {{amount}} ({{currency}}). Your invoice: {{invoiceUrl}}\n\nThanks for supporting Traugily!',
  },
  payment_failed: {
    subject: 'Action needed: Traugily payment failed',
    body: 'We could not process your latest payment of {{amount}} ({{currency}}).\n\nPlease update your payment details here: {{portalUrl}}\n\nWe will remind you daily until this is resolved. If it remains unpaid for 14 days your subscription will end, but your training data stays safe and exportable.',
  },
  subscription_canceled: {
    subject: 'Your Traugily subscription has ended',
    body: 'Your subscription ended after 14 days of unpaid invoices, as described when you subscribed. Your data is preserved — you can export it or resubscribe at any time.',
  },
  report_ready: {
    subject: 'Your Traugily report is ready',
    body: 'Your progress report for {{period}} is ready to download: {{link}}',
  },
  account_deleted: {
    subject: 'Your Traugily account has been deleted',
    body: 'Your account and personal data have been deleted as requested. Retained operational records (such as billing invoices) are kept only where legally required.',
  },
};
