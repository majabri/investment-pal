import { z } from "zod";

export const MAX_SYMBOLS_PER_REQUEST = 50;
export const MAX_CALENDAR_DAYS = 21;
export const MAX_CHAT_MESSAGES = 12;
export const MAX_CHAT_TOTAL_CHARACTERS = 90_000;

const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(20)
  .regex(/^[A-Z0-9.^=/-]+$/, "Invalid symbol format");

export const symbolsInputSchema = z.object({
  symbols: z.array(symbolSchema).max(MAX_SYMBOLS_PER_REQUEST),
});

export const earningsCalendarInputSchema = z.object({
  symbols: z.array(symbolSchema).max(MAX_SYMBOLS_PER_REQUEST),
  days: z.number().int().min(1).max(MAX_CALENDAR_DAYS).optional(),
});

export const economicCalendarInputSchema = z.object({
  days: z.number().int().min(1).max(MAX_CALENDAR_DAYS).optional(),
});

const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().trim().min(1).max(75_000),
});

export const chatInputSchema = z
  .object({
    messages: z.array(chatMessageSchema).min(1).max(MAX_CHAT_MESSAGES),
  })
  .superRefine(({ messages }, ctx) => {
    if (messages.filter((message) => message.role === "system").length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only one system message is allowed",
        path: ["messages"],
      });
    }

    if (messages[0]?.role === "system" || !messages.some((message) => message.role === "system")) {
      const totalCharacters = messages.reduce(
        (total, message) => total + message.content.length,
        0,
      );
      if (totalCharacters > MAX_CHAT_TOTAL_CHARACTERS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Messages exceed the ${MAX_CHAT_TOTAL_CHARACTERS}-character limit`,
          path: ["messages"],
        });
      }
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "The system message must be first",
      path: ["messages", 0],
    });
  });
