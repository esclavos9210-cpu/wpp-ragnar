export interface ToolContext {
  whatsappJid?: string;
  clientPhone?: string;
  clientName?: string;
  // Mutable flags set by handlers during a single conversation turn
  agendarCitaCalled: boolean;
  cancelarCitaCalled: boolean;
  justShowedAllBarberList: boolean;
}
