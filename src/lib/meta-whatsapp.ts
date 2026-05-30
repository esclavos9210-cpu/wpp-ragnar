/**
 * src/lib/meta-whatsapp.ts
 * Cliente para la API oficial de WhatsApp Business (Meta Cloud API).
 * Se usa exclusivamente para mensajes PROACTIVOS (recordatorios de citas).
 * Las conversaciones entrantes siguen usando Baileys.
 */

const META_API_BASE = "https://graph.facebook.com/v19.0";

function getConfig() {
  const token = process.env.META_WA_TOKEN;
  const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error("META_WA_TOKEN y META_WA_PHONE_NUMBER_ID son requeridos");
  }
  return { token, phoneNumberId };
}

/**
 * Envía un mensaje de texto simple vía Meta API.
 * Solo funciona dentro de la ventana de 24h de conversación activa.
 */
export async function sendTextMessage(to: string, text: string): Promise<void> {
  const { token, phoneNumberId } = getConfig();
  const phone = to.replace(/\D/g, "");

  const res = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Meta API error (${res.status}): ${err}`);
  }
  console.log(`[meta-wa] texto enviado a ${phone}`);
}

/**
 * Envía un recordatorio de cita usando un template aprobado por Meta.
 *
 * Template requerido en Meta Business Manager:
 *   Nombre: appointment_reminder (o el que configures en META_WA_REMINDER_TEMPLATE)
 *   Idioma: es (español)
 *   Categoría: UTILITY
 *   Cuerpo: "Hola {{1}}, te recordamos tu cita en Barbería Ragnar hoy a las {{2}} con {{3}}. ¡Te esperamos! ✂️"
 *   Variables: [nombre_cliente, hora_12h, nombre_barbero]
 */
export async function sendAppointmentReminder(params: {
  phone: string;
  clientName: string;
  time12h: string;
  barberName: string;
}): Promise<void> {
  const { token, phoneNumberId } = getConfig();
  const templateName = process.env.META_WA_REMINDER_TEMPLATE ?? "appointment_reminder";
  const phone = params.phone.replace(/\D/g, "");

  const res = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: "es" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: params.clientName },
              { type: "text", text: params.time12h },
              { type: "text", text: params.barberName },
            ],
          },
        ],
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Meta API reminder error (${res.status}): ${err}`);
  }
  console.log(`[meta-wa] recordatorio enviado a ${phone} — ${params.clientName} ${params.time12h}`);
}

export function isMetaConfigured(): boolean {
  return !!(process.env.META_WA_TOKEN && process.env.META_WA_PHONE_NUMBER_ID);
}
