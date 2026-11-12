"use server";
import { answer, intentFromText, invoiceIdFromText, type ChatAnswer, type Intent } from "@/lib/chatbot";
import { getSessionUser } from "@/lib/session";
import { getState } from "@/lib/store";

const INTENTS: Intent[] = ["status", "why_held", "needs", "due", "late"];

/** Answers a supplier's question from their own invoice records. Read-only; refuses anyone who is not a supplier. */
export async function askPayment(input: { intent?: string; text?: string; invoiceId?: string }): Promise<ChatAnswer | { error: string }> {
  const u = await getSessionUser();
  if (!u || u.role !== "supplier") return { error: "Please sign in as a supplier." };
  const text = String(input.text ?? "").slice(0, 200);
  const intent = INTENTS.find((i) => i === input.intent) ?? intentFromText(text);
  const invoiceId = (input.invoiceId ? String(input.invoiceId).slice(0, 40) : undefined) ?? invoiceIdFromText(text);
  return answer(getState(), { username: u.username, vendorId: u.vendorId }, intent, invoiceId, text || undefined);
}
