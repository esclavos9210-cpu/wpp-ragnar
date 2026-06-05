import { searchCustomerByPhone, normalizePhone } from "@/lib/barberly/members";
import { upsertCustomerMapping } from "@/lib/db";
import type { ToolContext } from "../types";

export async function handleBuscarCliente(
  args: Record<string, string>,
  ctx: ToolContext,
): Promise<string> {
  const phone = args.telefono ?? "";
  const member = await searchCustomerByPhone(phone);
  if (member) {
    if (ctx.whatsappJid) {
      upsertCustomerMapping.run({
        whatsapp_number: ctx.whatsappJid,
        barberly_customer_id: member.Id,
        nombre: member.FullName,
        email: member.Email ?? "",
        phone_normalized: normalizePhone(phone),
      });
      console.log(
        `[customer-reused] whatsapp=${ctx.whatsappJid} barberly_id=${member.Id} nombre="${member.FullName}" source=phone_search`,
      );
    }
    return (
      `Cliente ENCONTRADO en Barberly:\n` +
      `- ID: ${member.Id}\n` +
      `- Nombre: ${member.FullName}\n` +
      `- Teléfono: ${member.PhoneNumber ?? phone}\n` +
      `- Email: ${member.Email ?? "(no registrado)"}\n` +
      `Usa estos datos para agendar. NO pidas más información al cliente.`
    );
  }
  return (
    `Cliente NUEVO (no registrado en Barberly). Esto es normal para clientes nuevos. Pídele en UN solo mensaje:\n` +
    `- Nombre completo\n` +
    `- Correo electrónico\n` +
    `(Su teléfono es: ${phone})`
  );
}
