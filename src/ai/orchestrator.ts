import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getSystemPrompt } from "@/lib/system-prompt";
import { TOOLS } from "./tools/definitions";
import { executeToolCall } from "./tools/executor";
import type { ToolContext } from "./tools/types";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export async function getChatResponse(
  history: HistoryMessage[],
  newUserMessage: string,
  clientPhone?: string,
  clientName?: string,
  whatsappJid?: string,
): Promise<string> {
  const clientCtx = clientName
    ? `\n\nNombre en WhatsApp del cliente: "${clientName}". Pídele siempre su número de teléfono real (con código de país, ej: +573001234567) antes de agendar.`
    : "";

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: getSystemPrompt() + clientCtx },
    ...history,
    { role: "user", content: newUserMessage },
  ];

  // Detectar teléfono en el mensaje → forzar buscar_cliente primero
  const stripped = newUserMessage
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/[^0-9+\s\-]/g, " ");
  const digitCount = (stripped.match(/\d/g) ?? []).length;
  const phoneInMessage =
    digitCount >= 10 && /(\+\d{1,3}[\s\-]?)?\d[\d\s\-]{9,}/.test(stripped);

  let toolChoice: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption = phoneInMessage
    ? { type: "function", function: { name: "buscar_cliente" } }
    : "auto";

  let response = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools: TOOLS,
    tool_choice: toolChoice,
    max_tokens: 1000,
  });

  const ctx: ToolContext = {
    whatsappJid,
    clientPhone,
    clientName,
    agendarCitaCalled: false,
    cancelarCitaCalled: false,
    justShowedAllBarberList: false,
  };

  // Loop de tool calls (máximo 12 iteraciones)
  // Reagendamiento necesita: listar_citas + consultar_disponibilidad +
  // cancelar_cita + agendar_cita = 4 mínimo. Con retries llega a 6-8.
  // 12 da margen suficiente sin riesgo de loop infinito.
  for (let i = 0; i < 12; i++) {
    const choice = response.choices[0];

    if (choice.finish_reason !== "tool_calls") {
      const content = choice.message.content ?? "";
      console.log(`[orchestrator] finish_reason=${choice.finish_reason} content_preview="${content.substring(0, 80)}"`);

      // Reintentar una vez si la respuesta llegó vacía en la primera iteración
      if (!content && i === 0) {
        console.warn("[orchestrator] respuesta vacía en iteración 0 — reintentando con auto");
        messages.push({ role: "user", content: "(Por favor responde al mensaje anterior del cliente.)" });
        response = await client.chat.completions.create({
          model: MODEL, messages, tools: TOOLS, tool_choice: "auto", max_tokens: 1000,
        });
        continue;
      }

      if (!content) {
        console.warn("[orchestrator] respuesta vacía definitiva");
        return "Disculpa, tuve un inconveniente. ¿Puedes repetir tu solicitud?";
      }

      // Guard: bloquear confirmaciones de agendamiento fabricadas sin llamar agendar_cita
      const c = content.toLowerCase();
      const mentionsCancellation = c.includes("cancel") || c.includes("anulada") || c.includes("anulé");
      const mentionsAvailability =
        c.includes("disponible") || c.includes("disponibilidad") ||
        c.includes("horarios") || c.includes("¿cuál te queda") || c.includes("cual te queda");
      const looksLikeQuestion = content.trim().endsWith("?") || c.includes("¿");
      const skipGuard =
        ctx.agendarCitaCalled || ctx.cancelarCitaCalled || mentionsCancellation || mentionsAvailability;
      const looksLikeBookingConfirmation =
        !skipGuard &&
        (c.includes("cita confirmada") ||
          c.includes("está confirmada") ||
          c.includes("confirmada para") ||
          c.includes("cita agendada") ||
          c.includes("te agendé") ||
          c.includes("te agendamos") ||
          c.includes("quedaste agendado") ||
          c.includes("aquí va la info de tu cita") ||
          (!looksLikeQuestion && c.includes("servicio:") && c.includes("fecha:") && c.includes("hora:")) ||
          (content.includes("✅") && (c.includes("cita") || c.includes("agend"))));

      if (looksLikeBookingConfirmation) {
        console.warn(`[orchestrator] BLOCKED: confirmación sin agendar_cita. content="${content.substring(0, 200)}"`);
        return "Disculpa, tuve un problema al registrar tu cita. ¿Puedes intentarlo de nuevo?";
      }

      return content;
    }

    messages.push(choice.message);

    // Procesar tool calls secuencialmente para preservar orden de mutaciones en ctx
    const toolResults: ChatCompletionMessageParam[] = [];
    for (const toolCall of choice.message.tool_calls ?? []) {
      console.log(`[orchestrator] tool_call: ${toolCall.function.name} args=${toolCall.function.arguments}`);
      const args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, string>;
      const result = await executeToolCall(toolCall.function.name, toolCall.id, args, ctx);
      toolResults.push(result);
    }

    messages.push(...toolResults);
    response = await client.chat.completions.create({
      model: MODEL, messages, tools: TOOLS, tool_choice: "auto", max_tokens: 1000,
    });
  }

  const lastContent = response.choices[0].message.content;
  if (!lastContent) {
    console.warn("[orchestrator] loop agotado sin respuesta final — devolviendo fallback");
    return "Disculpa, tuve un problema procesando tu solicitud. ¿Puedes intentarlo de nuevo?";
  }
  return lastContent;
}
