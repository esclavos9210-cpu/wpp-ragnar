import type OpenAI from "openai";

export const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "buscar_cliente",
      description:
        "Busca si un cliente ya existe en Barberly por su número de teléfono. Llámala SIEMPRE después de que el cliente dé su teléfono, ANTES de pedir más datos.",
      parameters: {
        type: "object",
        properties: {
          telefono: { type: "string", description: "Teléfono con código de país ej: +573001234567" },
        },
        required: ["telefono"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_servicios",
      description:
        "Obtiene la lista de servicios disponibles en Barbería Ragnar con precios y duración.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_barberos",
      description:
        "Obtiene la lista de barberos que actualmente trabajan en Barbería Ragnar. Úsala cuando el cliente pregunte si un barbero específico trabaja aquí, quiénes son los barberos, o quiera saber el equipo disponible.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_disponibilidad",
      description:
        "OBLIGATORIO: Llama esta función SIEMPRE que el cliente mencione disponibilidad, una fecha o una hora. NUNCA respondas sobre horarios sin llamarla primero.",
      parameters: {
        type: "object",
        properties: {
          service_name: { type: "string", description: "Nombre del servicio (ej: 'Corte clásico', 'Corte + Barba')" },
          fecha: { type: "string", description: "Fecha deseada en formato YYYY-MM-DD" },
          barbero: { type: "string", description: "Nombre del barbero preferido (opcional)" },
          hora_solicitada: {
            type: "string",
            description:
              "Hora exacta que pidió el cliente en formato 24h (ej: '16:00'). Solo incluir si el cliente mencionó una hora específica.",
          },
        },
        required: ["service_name", "fecha"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listar_citas",
      description:
        "Lista las citas próximas de un cliente. Úsala ANTES de cancelar o reagendar para obtener el ID de la cita.",
      parameters: {
        type: "object",
        properties: {
          telefono: { type: "string", description: "Teléfono del cliente con código de país" },
        },
        required: ["telefono"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancelar_cita",
      description:
        "Cancela una cita existente. Usa el cita_id del historial de conversación (Ref: ID del mensaje de confirmación) o de listar_citas. NUNCA uses agendar_cita para cancelar.",
      parameters: {
        type: "object",
        properties: {
          cita_id: {
            type: "string",
            description:
              "ID de la cita a cancelar (del Ref: en el mensaje de confirmación o de listar_citas)",
          },
        },
        required: ["cita_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agendar_cita",
      description:
        "Agenda una cita. Llámala INMEDIATAMENTE cuando el cliente confirme. NUNCA digas 'Cita confirmada' sin llamarla. Si el cliente pidió un barbero específico, DEBES incluir el campo 'barbero'.",
      parameters: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Fecha en formato YYYY-MM-DD" },
          hora: { type: "string", description: "Hora en formato HH:MM (24h)" },
          service_name: { type: "string", description: "Nombre del servicio confirmado" },
          nombre_cliente: { type: "string", description: "Nombre del cliente" },
          apellido_cliente: { type: "string", description: "Apellido del cliente (opcional)" },
          telefono_cliente: { type: "string", description: "Teléfono con código de país ej: +573001234567" },
          email_cliente: { type: "string", description: "Correo electrónico del cliente" },
          barbero: { type: "string", description: "Nombre del barbero preferido (opcional)" },
        },
        required: ["fecha", "hora", "service_name", "nombre_cliente", "telefono_cliente"],
      },
    },
  },
];
