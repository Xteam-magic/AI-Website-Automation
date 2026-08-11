import nodemailer, { Transporter } from "nodemailer";
import fs from "fs";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { retry } from "../helpers/retry";

const log = logger.scope("Gmail");

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: config.secrets.gmailEmail,
        pass: config.secrets.gmailAppPassword,
      },
    });
  }
  return transporter;
}

interface MailAttachment {
  filename: string;
  path: string;
}

interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

/**
 * The only function that actually calls the SMTP transport. Every outgoing
 * email always also goes to the fixed admin address, per project rule.
 * This is the single choke point mail.ts's file-level responsibility
 * ("all project emails only sent from this file") depends on.
 */
async function sendMail(input: SendMailInput): Promise<void> {
  const recipients = Array.from(new Set([input.to, config.email.adminEmail].filter((e) => !!e)));

  const attachments = (input.attachments ?? []).filter((a) => {
    const exists = fs.existsSync(a.path);
    if (!exists) {
      log.warn(`Attachment not found on disk, skipping: ${a.path}`);
    }
    return exists;
  });

  await retry(
    async () => {
      await getTransporter().sendMail({
        from: config.secrets.gmailEmail,
        to: recipients.join(","),
        subject: input.subject,
        text: input.text,
        attachments,
      });
    },
    { retries: config.retries.email, label: `Email: ${input.subject}` }
  );

  log.info(`Sent "${input.subject}" to ${recipients.join(", ")}`);
}

/** Sent once, when a project is picked up and moves Start -> Running. */
export async function sendProjectStartedEmail(params: {
  userEmail: string;
  projectName: string;
  pageCount: number;
  currentStage: string;
}): Promise<void> {
  await sendMail({
    to: params.userEmail,
    subject: "شروع پروژه",
    text: [
      "شروع پروژه",
      "",
      `پروژه: ${params.projectName}`,
      `تعداد صفحات: ${params.pageCount}`,
      `مرحله فعلی: ${params.currentStage}`,
    ].join("\n"),
  });
}

/** Sent right before Generate is clicked for a specific page. */
export async function sendPageStartedEmail(params: {
  userEmail: string;
  projectName: string;
  pageName: string;
  pageIndex: number;
  totalPages: number;
  estimatedMinutes: number;
}): Promise<void> {
  await sendMail({
    to: params.userEmail,
    subject: "شروع طراحی صفحه",
    text: [
      "شروع طراحی صفحه",
      "",
      `Project: ${params.projectName}`,
      `Page: ${params.pageName} (${params.pageIndex} از ${params.totalPages})`,
      `Estimated Time: ${params.estimatedMinutes} دقیقه`,
    ].join("\n"),
  });
}

/** Sent when a single page finishes (Generate + HTML + Figma/Elementor for that page). */
export async function sendPageCompletedEmail(params: {
  userEmail: string;
  projectName: string;
  pageName: string;
  nextStep: string;
  htmlFilePath?: string;
  jsonFilePath?: string;
}): Promise<void> {
  const attachments: MailAttachment[] = [];
  if (params.htmlFilePath) attachments.push({ filename: "index.html", path: params.htmlFilePath });
  if (params.jsonFilePath) attachments.push({ filename: `${params.pageName}.json`, path: params.jsonFilePath });

  await sendMail({
    to: params.userEmail,
    subject: "طراحی صفحه تکمیل شد",
    text: [
      "سلام",
      "",
      `صفحه ${params.pageName}`,
      `پروژه ${params.projectName}`,
      "با موفقیت طراحی شد.",
      "فایل های مربوطه ضمیمه شده اند.",
      "",
      `مرحله بعد: ${params.nextStep}`,
      "",
      "با تشکر",
    ].join("\n"),
    attachments,
  });
}

/** Sent once, when the last page of the project finishes and Status becomes Completed. */
export async function sendProjectCompletedEmail(params: {
  userEmail: string;
  projectName: string;
}): Promise<void> {
  await sendMail({
    to: params.userEmail,
    subject: "پروژه تکمیل شد",
    text: [
      "تمام پروژه تکمیل شد.",
      "",
      `پروژه: ${params.projectName}`,
      "تمام فایل ها آماده هستند.",
    ].join("\n"),
  });
}

/** Sent on any workflow-stopping error, with the last screenshot attached if available. */
export async function sendErrorEmail(params: {
  userEmail: string;
  projectName: string;
  step: string;
  errorMessage: string;
  lastUrl: string;
  screenshotPath?: string;
}): Promise<void> {
  const attachments: MailAttachment[] = [];
  if (params.screenshotPath) {
    attachments.push({ filename: "error-screenshot.png", path: params.screenshotPath });
  }

  await sendMail({
    to: params.userEmail,
    subject: "Project Failed",
    text: [
      `Project: ${params.projectName}`,
      `Step: ${params.step}`,
      `Error: ${params.errorMessage}`,
      `Last URL: ${params.lastUrl}`,
      `Time: ${new Date().toISOString()}`,
    ].join("\n"),
    attachments,
  });
}
