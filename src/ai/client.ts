import { config } from "../config/config";
import { logger } from "../logger/logger";
import { ProjectRow } from "../types";

const log = logger.scope("AI/Client");

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export interface AiClient {
  complete(messages: ChatMessage[]): Promise<string>;
}

function getRowValue(row: ProjectRow, names: string[]): string {
  const normalized = new Map(Object.entries(row.rawColumns).map(([key, value]) => [key.trim().toLowerCase(), value]));
  for (const name of names) {
    const found = normalized.get(name.trim().toLowerCase());
    if (found && found.trim()) return found.trim();
  }
  return "";
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function extractTextFromResponse(provider: string, data: any): string {
  if (provider === "anthropic") {
    return Array.isArray(data?.content)
      ? data.content.filter((x: any) => x?.type === "text").map((x: any) => x.text).join("\n")
      : "";
  }

  const choices = Array.isArray(data?.choices) ? data.choices : [];
  return choices[0]?.message?.content ?? choices[0]?.text ?? "";
}

export function createAiClient(row: ProjectRow): AiClient {
  const provider = (getRowValue(row, ["AI Provider"]) || config.ai.provider).trim().toLowerCase();
  const apiKey = row.aiTokenAccount.trim();
  if (!apiKey) {
    throw new Error("AI Token Account is empty for this project; phase 2 cannot start safely.");
  }

  const baseUrl = normalizeBaseUrl(
    getRowValue(row, ["AI Base URL"]) || config.ai.gapGptBaseUrl
  );
  const model = getRowValue(row, ["AI Model"]) || config.ai.model;
  const maxTokens = Number(getRowValue(row, ["AI Max Output Tokens"]) || config.ai.maxOutputTokens);
  const temperature = Number(getRowValue(row, ["AI Temperature"]) || config.ai.temperature);

  return {
    async complete(messages: ChatMessage[]): Promise<string> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeouts.aiRequestMs);

      try {
        const isAnthropic = provider === "anthropic" || provider === "claude";
        const url = isAnthropic ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`;
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };

        let body: unknown;
        if (isAnthropic) {
          headers["x-api-key"] = apiKey;
          headers["anthropic-version"] = "2023-06-01";
          body = {
            model,
            max_tokens: maxTokens,
            temperature,
            system: messages.find((m) => m.role === "system")?.content ?? "",
            messages: messages
              .filter((m) => m.role !== "system")
              .map((m) => ({ role: m.role, content: m.content })),
          };
        } else {
          headers.Authorization = `Bearer ${apiKey}`;
          body = {
            model,
            temperature,
            max_tokens: maxTokens,
            messages,
          };
        }

        log.info(`Calling AI provider "${provider}" with model "${model}".`);
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const text = await response.text();
        if (!response.ok) {
          throw new Error(`AI request failed: HTTP ${response.status} ${text.slice(0, 1200)}`);
        }

        const data = JSON.parse(text);
        const output = extractTextFromResponse(provider, data).trim();
        if (!output) throw new Error("AI provider returned an empty response.");
        return output;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
