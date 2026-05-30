import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { scheduleAppointment, getServices, getAvailableSlots, getEmployees, searchCustomerByPhone, normalizePhone, getCustomerBookings, cancelBooking, getBookingById } from "./barberly";
import { getSystemPrompt } from "./system-prompt";
import { getCustomerMappingByWhatsApp, upsertCustomerMapping, setLastAppointmentId } from "./db";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "buscar_cliente",
      description: "Busca si un cliente ya existe en Barberly por su número de teléfono. Llámala SIEMPRE después de que el cliente dé su teléfono, ANTES de pedir más datos.",
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
      description: "Obtiene la lista de servicios disponibles en Barbería Ragnar con precios y duración.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_disponibilidad",
      description: "OBLIGATORIO: Llama esta función SIEMPRE que el cliente mencione disponibilidad, una fecha o una hora. NUNCA respondas sobre horarios sin llamarla primero.",
      parameters: {
        type: "object",
        properties: {
          service_name: { type: "string", description: "Nombre del servicio (ej: 'Corte clásico', 'Corte + Barba')" },
          fecha: { type: "string", description: "Fecha deseada en formato YYYY-MM-DD" },
          barbero: { type: "string", description: "Nombre del barbero preferido (opcional)" },
        },
        required: ["service_name", "fecha"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listar_citas",
      description: "Lista las citas próximas de un cliente. Úsala ANTES de cancelar o reagendar para obtener el ID de la cita.",
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
      description: "Cancela una cita existente. Usa el cita_id del historial de conversación (Ref: ID del mensaje de confirmación) o de listar_citas. NUNCA uses agendar_cita para cancelar.",
      parameters: {
        type: "object",
        properties: {
          cita_id: { type: "string", description: "ID de la cita a cancelar (del Ref: en el mensaje de confirmación o de listar_citas)" },
        },
        required: ["cita_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agendar_cita",
      description: "Agenda una cita. Llámala INMEDIATAMENTE cuando el cliente confirme. NUNCA digas 'Cita confirmada' sin llamarla. Si el cliente pidió un barbero específico, DEBES incluir el campo 'barbero'.",
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

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export async function getChatResponse(
  history: HistoryMessage[],
  newUserMessage: string,
  clientPhone?: string,
  clientName?: string,
  whatsappJid?: string
): Promise<string> {
  const clientCtx = clientName
    ? `\n\nNombre en WhatsApp del cliente: "${clientName}". Pídele siempre su número de teléfono real (con código de país, ej: +573001234567) antes de agendar.`
    : "";

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: getSystemPrompt() + clientCtx },
    ...history,
    { role: "user", content: newUserMessage },
  ];

  // Detectar si el mensaje contiene un número de teléfono (≥10 dígitos, con o sin +código país)
  const phoneInMessage = /(\+\d{1,3}[\s\-]?)?\d[\d\s\-]{9,}/.test(newUserMessage.replace(/[^0-9+\s\-]/g, " "));

  // Detectar si el cliente quiere agendar mencionando una hora — forzar consulta de disponibilidad
  // para evitar que el LLM reutilice respuestas anteriores del historial.
  const msg = newUserMessage.toLowerCase();
  const bookingWithTime =
    (msg.includes("agendar") || msg.includes("cita") || msg.includes("reservar")) &&
    /\d{1,2}\s*(am|pm|a\.m\.|p\.m\.)|a las \d|para las \d|\d{1,2}:\d{2}/.test(msg);

  let toolChoice: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
  if (phoneInMessage) {
    // Si hay teléfono, forzar búsqueda del cliente primero
    toolChoice = { type: "function", function: { name: "buscar_cliente" } };
  } else if (bookingWithTime) {
    // Si pide cita con hora específica, forzar consulta de disponibilidad fresca
    toolChoice = { type: "function", function: { name: "consultar_disponibilidad" } };
  } else {
    toolChoice = "auto";
  }

  let response = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools: TOOLS,
    tool_choice: toolChoice,
    max_tokens: 1000,
  });

  let agendarCitaCalled = false;

  // Loop de tool calls (máximo 5 iteraciones — cancelar requiere listar + cancelar + responder)
  for (let i = 0; i < 5; i++) {
    const choice = response.choices[0];
    if (choice.finish_reason !== "tool_calls") {
      const content = choice.message.content ?? "";
      console.log(`[openrouter] finish_reason=${choice.finish_reason} content_preview="${content.substring(0, 80)}"`);

      // Si el modelo devolvió vacío, reintentar una vez con prompt simplificado
      if (!content && i === 0) {
        console.warn("[openrouter] respuesta vacía en iteración 0 — reintentando con auto");
        messages.push({ role: "user", content: "(Por favor responde al mensaje anterior del cliente.)" });
        response = await client.chat.completions.create({
          model: MODEL,
          messages,
          tools: TOOLS,
          tool_choice: "auto",
          max_tokens: 1000,
        });
        continue;
      }

      if (!content) {
        console.warn("[openrouter] respuesta vacía definitiva");
        return "Disculpa, tuve un inconveniente. ¿Puedes repetir tu solicitud?";
      }

      // Si el LLM genera confirmación sin haber llamado agendar_cita, bloquearlo
      const c = content.toLowerCase();
      const looksLikeConfirmation =
        c.includes("cita confirmada") ||
        c.includes("está confirmada") ||
        c.includes("confirmada para") ||
        c.includes("cita está lista") ||
        c.includes("cita agendada") ||
        c.includes("te agendé") ||
        c.includes("te agendamos") ||
        c.includes("quedaste agendado") ||
        c.includes("aquí va la info de tu cita") ||
        c.includes("todo listo") ||
        content.includes("✅") ||
        (c.includes("servicio:") && c.includes("fecha:") && c.includes("hora:"));
      if (looksLikeConfirmation && !agendarCitaCalled) {
        console.warn("[openrouter] BLOCKED: confirmación sin agendar_cita");
        return "Disculpa, tuve un problema al registrar tu cita. ¿Puedes intentarlo de nuevo?";
      }
      return content;
    }

    messages.push(choice.message);
    const toolResults: ChatCompletionMessageParam[] = [];

    for (const toolCall of choice.message.tool_calls ?? []) {
      let result = "";
      console.log(`[openrouter] tool_call: ${toolCall.function.name} args=${toolCall.function.arguments}`);
      try {
        const args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, string>;

        if (toolCall.function.name === "listar_citas") {
          const phone = args.telefono ?? "";
          const mapping = whatsappJid ? getCustomerMappingByWhatsApp.get({ whatsapp_number: whatsappJid }) : null;

          // Fecha de hoy en Colombia (UTC-5) como string "YYYY-MM-DD"
          const todayColombiaStr = new Date(
            new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })
          ).toISOString().split("T")[0];

          function formatBookings(bookings: Awaited<ReturnType<typeof getCustomerBookings>>) {
            const upcoming = bookings.filter((b) => b.TimeSlot.Date.split("T")[0] >= todayColombiaStr);
            if (upcoming.length === 0) return null;
            return `Citas próximas del cliente:\n` + upcoming.map((b) => {
              const h = Math.floor(b.TimeSlot.StartMinutesOfDay / 60).toString().padStart(2, "0");
              const m = (b.TimeSlot.StartMinutesOfDay % 60).toString().padStart(2, "0");
              return `• ID: ${b.Id} | Fecha: ${b.TimeSlot.Date.split("T")[0]} | Hora: ${h}:${m}`;
            }).join("\n");
          }

          // 1. Intentar con last_appointment_id (lookup directo por ID)
          if (mapping?.last_appointment_id) {
            console.log(`[listar_citas] intentando last_appointment_id=${mapping.last_appointment_id}`);
            const booking = await getBookingById(mapping.last_appointment_id);
            if (booking) {
              const bookingDateStr = booking.TimeSlot.Date.split("T")[0];
              if (bookingDateStr >= todayColombiaStr) {
                const h = Math.floor(booking.TimeSlot.StartMinutesOfDay / 60).toString().padStart(2, "0");
                const m = (booking.TimeSlot.StartMinutesOfDay % 60).toString().padStart(2, "0");
                result = `Cita próxima del cliente:\n• ID: ${booking.Id} | Fecha: ${bookingDateStr} | Hora: ${h}:${m}`;
              }
            }
          }

          // 2. Si aún no hay resultado, buscar todas las citas por customerId del mapping
          if (!result && mapping?.barberly_customer_id) {
            console.log(`[listar_citas] intentando getCustomerBookings customerId=${mapping.barberly_customer_id}`);
            const bookings = await getCustomerBookings(mapping.barberly_customer_id);
            result = formatBookings(bookings) ?? "";
          }

          // 3. Si aún no hay resultado, buscar por teléfono en Barberly
          if (!result && phone) {
            const member = await searchCustomerByPhone(phone);
            if (member) {
              console.log(`[listar_citas] encontrado por teléfono: ${member.Id}`);
              const bookings = await getCustomerBookings(member.Id);
              result = formatBookings(bookings) ?? "";
            }
          }

          // 4. Sin resultado tras todos los intentos
          if (!result) {
            result = phone
              ? `No encontré citas activas para este cliente. Si el número ${phone} es correcto, puede que no tenga citas registradas en Barberly.`
              : `No tengo el teléfono del cliente. Pídele su número de cel (con código de país, ej: +573001234567) para buscar sus citas.`;
          }
        }

        else if (toolCall.function.name === "cancelar_cita") {
          const citaId = args.cita_id ?? "";
          if (!citaId) {
            result = `Necesitas el ID de la cita para cancelar. Llama primero a listar_citas.`;
          } else {
            const cancelResult = await cancelBooking(citaId);
            result = cancelResult.message;
          }
        }

        else if (toolCall.function.name === "buscar_cliente") {
          const phone = args.telefono ?? "";
          const member = await searchCustomerByPhone(phone);
          if (member) {
            // Persistir mapping WhatsApp → Barberly para no volver a buscar
            if (whatsappJid) {
              upsertCustomerMapping.run({
                whatsapp_number: whatsappJid,
                barberly_customer_id: member.Id,
                nombre: member.FullName,
                email: member.Email ?? "",
                phone_normalized: normalizePhone(phone),
              });
              console.log(`[customer-reused] whatsapp=${whatsappJid} barberly_id=${member.Id} nombre="${member.FullName}" source=phone_search`);
            }
            result = `Cliente ENCONTRADO en Barberly:\n- ID: ${member.Id}\n- Nombre: ${member.FullName}\n- Teléfono: ${member.PhoneNumber ?? phone}\n- Email: ${member.Email ?? "(no registrado)"}\nUsa estos datos para agendar. NO pidas más información al cliente.`;
          } else {
            result = `Cliente NUEVO (no registrado en Barberly). Esto es normal para clientes nuevos. Pídele en UN solo mensaje:\n- Nombre completo\n- Correo electrónico\n(Su teléfono es: ${phone})`;
          }
        }

        else if (toolCall.function.name === "consultar_servicios") {
          const svcs = await getServices();
          result = svcs
            .map((s) => `• ${s.Name} — $${s.Price.toLocaleString("es-CO")} COP (${s.Duration} min)`)
            .join("\n");
        }

        else if (toolCall.function.name === "consultar_disponibilidad") {
          const svcs = await getServices();
          const svcMatch = svcs.find((s) =>
            s.Name.toLowerCase().includes(args.service_name?.toLowerCase() ?? "") ||
            (args.service_name?.toLowerCase() ?? "").includes(s.Name.toLowerCase())
          );
          if (!svcMatch) {
            result = `Servicio "${args.service_name}" no encontrado. Servicios disponibles: ${svcs.map((s) => s.Name).join(", ")}`;
          } else {
            let empId: string | undefined;
            if (args.barbero) {
              const emps = await getEmployees();
              const normalize = (s: string) =>
                s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
              empId = emps.find((e) =>
                normalize(e.FullName).includes(normalize(args.barbero))
              )?.Id;
            }
            const slots = await getAvailableSlots(svcMatch.Id, args.fecha, empId);
            if (slots.length === 0) {
              result = `No hay disponibilidad para "${svcMatch.Name}" el ${args.fecha}. Prueba otra fecha.`;
            } else {
              const to12h = (t: string) => {
                const [h, m] = t.split(":").map(Number);
                const period = h >= 12 ? "pm" : "am";
                const h12 = h % 12 || 12;
                return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
              };

              // Agrupar por fecha y limitar a 8 slots: los más cercanos a la hora pedida
              const byDate = new Map<string, string[]>();
              for (const s of slots) {
                if (!byDate.has(s.date)) byDate.set(s.date, []);
                byDate.get(s.date)!.push(s.time); // guardar 24h para ordenar
              }

              const lines: string[] = [];
              for (const [date, times] of byDate) {
                // Si el cliente pidió una hora, ordenar por cercanía a ella
                let sorted = [...times];
                if (args.hora) {
                  const [rh, rm] = args.hora.replace(/[^\d:]/g, "").split(":").map(Number);
                  const reqMin = (rh || 0) * 60 + (rm || 0);
                  sorted.sort((a, b) => {
                    const [ah, am] = a.split(":").map(Number);
                    const [bh, bm] = b.split(":").map(Number);
                    return Math.abs(ah * 60 + am - reqMin) - Math.abs(bh * 60 + bm - reqMin);
                  });
                }
                const displayed = sorted.slice(0, 8).sort(); // max 8, ordenados
                lines.push(`• ${date}: ${displayed.map(to12h).join(", ")}`);
              }
              result = `Horarios disponibles para "${svcMatch.Name}":\n${lines.join("\n")}\n\nAl agendar usa formato 24h (ej: 4:00 pm → 16:00, 5:00 pm → 17:00).`;
            }
          }
        }

        else if (toolCall.function.name === "agendar_cita") {
          // Normalizar hora a formato HH:MM 24h
          // Acepta: "17", "17:00", "5pm", "5:00 pm", "A las 17", "las 5pm"
          if (args.hora) {
            const raw = args.hora.trim();
            // Extraer número y opcional am/pm
            const m = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
            if (m) {
              let h = parseInt(m[1]);
              const min = parseInt(m[2] ?? "0");
              const period = m[3]?.toLowerCase();
              if (period === "pm" && h !== 12) h += 12;
              else if (period === "am" && h === 12) h = 0;
              // Sin am/pm: si h < 8 asumir pm (horario barbería)
              else if (!period && h > 0 && h < 8) h += 12;
              args.hora = `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
            }
          }
          const svcs = await getServices();
          const svcMatch = svcs.find((s) =>
            s.Name.toLowerCase().includes(args.service_name?.toLowerCase() ?? "") ||
            (args.service_name?.toLowerCase() ?? "").includes(s.Name.toLowerCase())
          );
          if (!svcMatch) {
            result = `Servicio "${args.service_name}" no encontrado.`;
          } else {
            // Buscar customer_id pre-resuelto en DB local (guardado por buscar_cliente)
            let knownCustomerId: string | undefined;
            let resolvedName = args.nombre_cliente ?? clientName ?? "Cliente";
            let resolvedEmail = args.email_cliente ?? "";
            let resolvedPhone = args.telefono_cliente ?? clientPhone ?? "";

            if (whatsappJid) {
              const mapping = getCustomerMappingByWhatsApp.get({ whatsapp_number: whatsappJid });
              if (mapping) {
                knownCustomerId = mapping.barberly_customer_id;
                if (mapping.nombre) resolvedName = mapping.nombre;
                if (mapping.email) resolvedEmail = mapping.email;
                if (mapping.phone_normalized) resolvedPhone = mapping.phone_normalized;
                console.log(
                  `[customer-reused] agendar: whatsapp=${whatsappJid} barberly_id=${knownCustomerId} nombre="${resolvedName}" source=local_db`
                );
              }
            }

            let empId: string | undefined;
            if (args.barbero) {
              const emps = await getEmployees();
              const normalize = (s: string) =>
                s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
              empId = emps.find((e) =>
                normalize(e.FullName).includes(normalize(args.barbero))
              )?.Id;
            }

            const appt = await scheduleAppointment({
              date: args.fecha,
              time: args.hora,
              serviceId: svcMatch.Id,
              serviceName: svcMatch.Name,
              clientFirstName: resolvedName,
              clientLastName: args.apellido_cliente,
              clientPhone: resolvedPhone,
              clientEmail: resolvedEmail || undefined,
              employeeId: empId,
              customerId: knownCustomerId,
            });

            // Si fue exitoso y hay JID, persistir el mapping (cubre clientes nuevos)
            if (appt.success && whatsappJid && appt.customerId) {
              upsertCustomerMapping.run({
                whatsapp_number: whatsappJid,
                barberly_customer_id: appt.customerId,
                nombre: resolvedName,
                email: resolvedEmail,
                phone_normalized: normalizePhone(resolvedPhone),
              });
              if (appt.appointmentId) {
                setLastAppointmentId.run({ whatsapp_number: whatsappJid, last_appointment_id: appt.appointmentId });
              }
              console.log(`[customer-created] persistido: whatsapp=${whatsappJid} barberly_id=${appt.customerId} appt_id=${appt.appointmentId}`);
            }

            agendarCitaCalled = true;
            console.log(`[agendar_cita] success=${appt.success} empId=${empId ?? "auto"} hora=${args.hora} fecha=${args.fecha} msg="${appt.message.substring(0, 100)}"`);
            if (!appt.success) {
              // Cuando falla, pedir verificar disponibilidad fresca antes de reintentar
              result = `${appt.message}\n\nLlama a consultar_disponibilidad para obtener horarios realmente disponibles y ofrece alternativas al cliente.`;
            } else {
              result = appt.message;
            }
          }
        }
      } catch (err) {
        console.error(`[openrouter] error en ${toolCall.function.name}:`, err);
        result = `Error ejecutando ${toolCall.function.name}: ${err instanceof Error ? err.message : String(err)}`;
      }

      toolResults.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }

    messages.push(...toolResults);
    response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      max_tokens: 1000,
    });
  }

  return response.choices[0].message.content ?? "";
}
