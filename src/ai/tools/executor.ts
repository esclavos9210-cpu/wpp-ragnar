import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ToolContext } from "./types";
import { handleBuscarCliente } from "./handlers/customer";
import { handleConsultarServicios, handleConsultarBarberos } from "./handlers/catalog";
import { handleConsultarDisponibilidad } from "./handlers/availability";
import { handleListarCitas, handleCancelarCita } from "./handlers/appointments";
import { handleAgendarCita } from "./handlers/booking";

type ToolHandlerFn = (args: Record<string, string>, ctx: ToolContext) => Promise<string>;

const HANDLERS: Record<string, ToolHandlerFn> = {
  buscar_cliente: handleBuscarCliente,
  consultar_servicios: handleConsultarServicios,
  consultar_barberos: handleConsultarBarberos,
  consultar_disponibilidad: handleConsultarDisponibilidad,
  listar_citas: handleListarCitas,
  cancelar_cita: handleCancelarCita,
  agendar_cita: handleAgendarCita,
};

export async function executeToolCall(
  toolName: string,
  toolCallId: string,
  args: Record<string, string>,
  ctx: ToolContext,
): Promise<ChatCompletionMessageParam> {
  const handler = HANDLERS[toolName];
  let content: string;
  try {
    if (!handler) {
      content = `Herramienta desconocida: ${toolName}`;
    } else {
      content = await handler(args, ctx);
    }
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    if (isAbort && toolName === "buscar_cliente") {
      console.warn(`[orchestrator] buscar_cliente timeout — tratando como cliente nuevo`);
      content = `No se pudo verificar si el cliente existe (timeout de red). Trata como cliente NUEVO: pide nombre completo y correo en UN solo mensaje.`;
    } else {
      console.error(`[orchestrator] error en ${toolName}:`, err);
      content = `Error ejecutando ${toolName}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return { role: "tool", tool_call_id: toolCallId, content };
}
