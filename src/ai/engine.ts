import type { BrowserContext, Page } from "playwright";
import fs from "fs";
import { config } from "../config/config";
import { logger } from "../logger/logger";
import { googleSheetService } from "../sheet/googleSheet";
import { ProjectRow } from "../types";
import { createAiClient, ChatMessage } from "./client";
import { buildPhase2SystemPrompt } from "./prompt";
import { executeTool, ToolCall } from "./tools";

const log = logger.scope("AI/Engine");

function parseJsonObject(text: string): ToolCall {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as ToolCall;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced) return JSON.parse(fenced[1]) as ToolCall;
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1)) as ToolCall;
    throw new Error(`AI returned non-JSON action: ${trimmed.slice(0, 500)}`);
  }
}

function readFullLogs(): string {
  try {
    return fs.existsSync(config.paths.logFile) ? fs.readFileSync(config.paths.logFile, "utf8") : "";
  } catch {
    return "";
  }
}

function trimNote(text: string): string {
  return text.length > 20_000 ? text.slice(-20_000) : text;
}

function appendAiNote(existing: string, line: string): string {
  const clean = line.replace(/(password|api[_ -]?key|token|secret)\s*[:=]\s*\S+/gi, "$1: [REDACTED]");
  return trimNote([existing.trim(), clean].filter(Boolean).join("\n"));
}

export async function runPhase2Ai(
  context: BrowserContext,
  row: ProjectRow,
  startPage: Page
): Promise<void> {
  const ai = createAiClient(row);
  const pages = new Map<string, Page>([["main", startPage]]);

  await googleSheetService.updateRow(row.rowNumber, {
    status: "AI Running",
    currentStep: "AI Load Context",
    aiEngineNote: appendAiNote(row.aiEngineNote, `[AI] Phase 2 started. Loaded ${row.headers.length} live sheet columns.`),
    fullLogs: readFullLogs(),
  });
  row.status = "AI Running";
  row.currentStep = "AI Load Context";

  const system = buildPhase2SystemPrompt(row, config.paths.root);
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: "Begin Phase 2. First inspect the project state and decide the next concrete action. Return one JSON action only." },
  ];

  const startedAt = Date.now();
  let lastAction = "";

  try {
    for (let step = 1; step <= config.timeouts.aiMaxSteps; step++) {
      if (Date.now() - startedAt > config.timeouts.aiLoopMs) {
        throw new Error(`AI phase exceeded ${config.timeouts.aiLoopMs / 60_000} minutes.`);
      }

      row.currentStep = step === 1 ? "AI Load Context" : "AI Execute";
      await googleSheetService.updateRow(row.rowNumber, {
        currentStep: row.currentStep,
        fullLogs: readFullLogs(),
      });

      const raw = await ai.complete(messages);
      const tool = parseJsonObject(raw);
      lastAction = tool.action;
      log.info(`AI step ${step}: ${tool.action}${tool.reason ? ` — ${tool.reason}` : ""}`);

      if (tool.action === "finish" || tool.done === true) {
        const result = tool.args ?? {};
        if (result.project_cost !== undefined) {
          await googleSheetService.updateColumnByHeader(row.rowNumber, "Project Cost", String(result.project_cost));
          row.projectCost = String(result.project_cost);
        }

        if (!row.projectCost.trim()) {
          messages.push({ role: "assistant", content: raw });
          messages.push({
            role: "user",
            content: "Project Cost is mandatory for finalization. Re-estimate the customer-facing total in Toman from the full project scope and update the exact 'Project Cost' column, then return finish again.",
          });
          continue;
        }

        const finalNote = appendAiNote(
          row.aiEngineNote,
          `[AI] Finished: ${String(result.result ?? result.summary ?? "completed")} | Verification: ${String(result.verification ?? "not supplied")} | Risk: ${String(result.unresolved_risk ?? "none reported")}`
        );

        await googleSheetService.updateRow(row.rowNumber, {
          status: "AI Running",
          currentStep: "AI Verify",
          aiEngineNote: finalNote,
          fullLogs: readFullLogs(),
        });

        await googleSheetService.updateRow(row.rowNumber, {
          currentStep: "AI Completed",
        });
        row.currentStep = "AI Completed";
        return;
      }

      if (!tool.action) throw new Error("AI response did not contain an action.");

      await googleSheetService.updateRow(row.rowNumber, {
        currentStep: "AI Execute",
        aiEngineNote: appendAiNote(row.aiEngineNote, `[AI] Step ${step}: ${tool.action}${tool.reason ? ` — ${tool.reason}` : ""}`),
      });

      let toolResult: string;
      try {
        toolResult = await executeTool(context, pages, row, tool);
      } catch (toolErr) {
        toolResult = JSON.stringify({
          error: toolErr instanceof Error ? toolErr.message : String(toolErr),
          action: tool.action,
          step,
        });
        log.error(`AI tool failed on step ${step}.`, toolErr);
      }

      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content: `Tool result for action ${tool.action}:\n${toolResult}\n\nContinue from this exact state. Inspect again if the result is ambiguous. Return one JSON action only.`,
      });
    }

    throw new Error(`AI phase reached the maximum action count (${config.timeouts.aiMaxSteps}). Last action: ${lastAction}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await googleSheetService.updateRow(row.rowNumber, {
      status: "Error AI",
      currentStep: "AI Verify",
      lastError: message.slice(0, 500),
      aiEngineNote: appendAiNote(row.aiEngineNote, `[AI] Phase 2 failed: ${message}`),
      fullLogs: readFullLogs(),
    });
    throw err;
  }
}
