import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// Asegura que la carpeta data/ exista
const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "messages.db");
const db = new Database(dbPath);

// WAL mode: permite que el proceso bot y Next.js lean/escriban concurrentemente
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ─── DDL ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT PRIMARY KEY,        -- JID de WhatsApp (ej: 5491112345678@s.whatsapp.net)
    name        TEXT NOT NULL DEFAULT '',
    mode        TEXT NOT NULL DEFAULT 'AI' CHECK(mode IN ('AI','HUMAN')),
    last_msg_at INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK(role IN ('user','bot','human')),
    content         TEXT NOT NULL,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

  CREATE TABLE IF NOT EXISTS connection_state (
    id        INTEGER PRIMARY KEY CHECK(id = 1),   -- solo 1 fila
    status    TEXT NOT NULL DEFAULT 'disconnected' CHECK(status IN ('disconnected','connecting','connected')),
    qr_data   TEXT,    -- Data URL PNG del QR (base64)
    phone     TEXT,    -- número conectado una vez autenticado
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  INSERT OR IGNORE INTO connection_state(id, status) VALUES (1, 'disconnected');

  CREATE TABLE IF NOT EXISTS outbox (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    content         TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'bot' CHECK(role IN ('bot','human')),
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    sent_at         INTEGER
  );

  CREATE TABLE IF NOT EXISTS customer_mapping (
    whatsapp_number       TEXT PRIMARY KEY,
    barberly_customer_id  TEXT NOT NULL,
    nombre                TEXT NOT NULL DEFAULT '',
    email                 TEXT NOT NULL DEFAULT '',
    phone_normalized      TEXT NOT NULL DEFAULT '',
    created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_customer_mapping_phone ON customer_mapping(phone_normalized);
  CREATE INDEX IF NOT EXISTS idx_customer_mapping_barberly ON customer_mapping(barberly_customer_id);
`);

// Migración: agregar last_appointment_id si la columna no existe aún
try {
  db.exec(`ALTER TABLE customer_mapping ADD COLUMN last_appointment_id TEXT`);
} catch {
  // columna ya existe — ignorar
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export type ConversationMode = "AI" | "HUMAN";
export type MessageRole = "user" | "bot" | "human";

export interface Conversation {
  id: string;
  name: string;
  mode: ConversationMode;
  last_msg_at: number;
  created_at: number;
}

export interface Message {
  id: number;
  conversation_id: string;
  role: MessageRole;
  content: string;
  created_at: number;
}

export interface ConnectionState {
  id: number;
  status: "disconnected" | "connecting" | "connected";
  qr_data: string | null;
  phone: string | null;
  updated_at: number;
}

export interface OutboxItem {
  id: number;
  conversation_id: string;
  content: string;
  role: "bot" | "human";
  created_at: number;
  sent_at: number | null;
}

// Conversaciones
export const getConversations = db.prepare<[], Conversation>(
  `SELECT * FROM conversations ORDER BY last_msg_at DESC`
);

export const upsertConversation = db.prepare<
  { id: string; name: string },
  void
>(
  `INSERT INTO conversations(id, name, last_msg_at)
   VALUES (@id, @name, unixepoch())
   ON CONFLICT(id) DO UPDATE SET
     name        = COALESCE(NULLIF(excluded.name,''), conversations.name),
     last_msg_at = unixepoch()`
);

export const touchConversation = db.prepare<{ id: string }, void>(
  `UPDATE conversations SET last_msg_at = unixepoch() WHERE id = @id`
);

export const setConversationMode = db.prepare<
  { id: string; mode: ConversationMode },
  void
>(`UPDATE conversations SET mode = @mode WHERE id = @id`);

export const getConversationById = db.prepare<{ id: string }, Conversation>(
  `SELECT * FROM conversations WHERE id = @id`
);

export const deleteConversation = db.prepare<{ id: string }, void>(
  `DELETE FROM conversations WHERE id = @id`
);

// Mensajes
export const getMessages = db.prepare<{ conversation_id: string }, Message>(
  `SELECT * FROM messages WHERE conversation_id = @conversation_id ORDER BY created_at ASC`
);

export const getRecentMessages = db.prepare<
  { conversation_id: string; limit: number },
  Message
>(
  `SELECT * FROM messages WHERE conversation_id = @conversation_id
   ORDER BY created_at DESC LIMIT @limit`
);

export const insertMessage = db.prepare<
  { conversation_id: string; role: MessageRole; content: string },
  void
>(
  `INSERT INTO messages(conversation_id, role, content)
   VALUES (@conversation_id, @role, @content)`
);

// Estado de conexión
export const getConnectionState = db.prepare<[], ConnectionState>(
  `SELECT * FROM connection_state WHERE id = 1`
);

export const setConnectionState = db.prepare<
  Partial<Omit<ConnectionState, "id" | "updated_at">>,
  void
>(
  `UPDATE connection_state SET
     status     = COALESCE(@status, status),
     qr_data    = @qr_data,
     phone      = COALESCE(@phone, phone),
     updated_at = unixepoch()
   WHERE id = 1`
);

// Outbox
export const enqueueOutbox = db.prepare<
  { conversation_id: string; content: string; role: "bot" | "human" },
  void
>(
  `INSERT INTO outbox(conversation_id, content, role) VALUES (@conversation_id, @content, @role)`
);

export const getPendingOutbox = db.prepare<[], OutboxItem>(
  `SELECT * FROM outbox WHERE sent_at IS NULL ORDER BY created_at ASC`
);

export const markOutboxSent = db.prepare<{ id: number }, void>(
  `UPDATE outbox SET sent_at = unixepoch() WHERE id = @id`
);

// Customer mapping (WhatsApp JID ↔ Barberly customer ID)
export interface CustomerMapping {
  whatsapp_number: string;
  barberly_customer_id: string;
  nombre: string;
  email: string;
  phone_normalized: string;
  last_appointment_id: string | null;
  created_at: number;
  updated_at: number;
}

export const getCustomerMappingByWhatsApp = db.prepare<{ whatsapp_number: string }, CustomerMapping>(
  `SELECT * FROM customer_mapping WHERE whatsapp_number = @whatsapp_number`
);

export const getCustomerMappingByPhone = db.prepare<{ phone_normalized: string }, CustomerMapping>(
  `SELECT * FROM customer_mapping WHERE phone_normalized = @phone_normalized`
);

export const setLastAppointmentId = db.prepare<
  { whatsapp_number: string; last_appointment_id: string },
  void
>(
  `UPDATE customer_mapping SET last_appointment_id = @last_appointment_id WHERE whatsapp_number = @whatsapp_number`
);

export const upsertCustomerMapping = db.prepare<
  { whatsapp_number: string; barberly_customer_id: string; nombre: string; email: string; phone_normalized: string },
  void
>(
  `INSERT INTO customer_mapping(whatsapp_number, barberly_customer_id, nombre, email, phone_normalized)
   VALUES (@whatsapp_number, @barberly_customer_id, @nombre, @email, @phone_normalized)
   ON CONFLICT(whatsapp_number) DO UPDATE SET
     barberly_customer_id = excluded.barberly_customer_id,
     nombre = CASE WHEN excluded.nombre != '' THEN excluded.nombre ELSE customer_mapping.nombre END,
     email  = CASE WHEN excluded.email  != '' THEN excluded.email  ELSE customer_mapping.email  END,
     phone_normalized = CASE WHEN excluded.phone_normalized != '' THEN excluded.phone_normalized ELSE customer_mapping.phone_normalized END,
     updated_at = unixepoch()`
);

export default db;
