import fs from "fs";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { retry } from "../helpers/retry";

const log = logger.scope("Email");

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_EMAIL = "X-Magic Automation <onboarding@resend.dev>";

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
 * Sends project emails through Resend API.
 * This replaces the previous Gmail SMTP transport.
 */
async function sendMail(input: SendMailInput): Promise<void> {
  const recipients = Array.from(
    new Set(
      [input.to, config.email.adminEmail].filter(
        (e): e is string => !!e
      )
    )
  );

  const attachments = (input.attachments ?? [])
    .filter((a) => {
      const exists = fs.existsSync(a.path);

      if (!exists) {
        log.warn(`Attachment not found on disk, skipping: ${a.path}`);
      }

      return exists;
    })
    .map((a) => ({
      filename: a.filename,
      content: fs.readFileSync(a.path).toString("base64"),
    }));

  await retry(
    async () => {
      const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.secrets.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: recipients,
          subject: input.subject,
          text: input.text,
          ...(attachments.length > 0 ? { attachments } : {}),
        }),
      });

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(
          `Resend API failed (${response.status}): ${responseText}`
        );
      }

      log.info(`Resend accepted email: ${responseText}`);
    },
    {
      retries: config.retries.email,
      label: `Email: ${input.subject}`,
    }
  );

  log.info(
    `Sent "${input.subject}" to ${recipients.join(", ")}`
  );
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

/** Sent when a single page finishes. */
export async function sendPageCompletedEmail(params: {
  userEmail: string;
  projectName: string;
  pageName: string;
  nextStep: string;
  htmlFilePath?: string;
  jsonFilePath?: string;
}): Promise<void> {
  const attachments: MailAttachment[] = [];

  if (params.htmlFilePath) {
    attachments.push({
      filename: "index.html",
      path: params.htmlFilePath,
    });
  }

  if (params.jsonFilePath) {
    attachments.push({
      filename: `${params.pageName}.json`,
      path: params.jsonFilePath,
    });
  }

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

/** Sent once, when the last page of the project finishes. */
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

/** Sent on any workflow-stopping error. */
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
    attachments.push({
      filename: "error-screenshot.png",
      path: params.screenshotPath,
    });
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
