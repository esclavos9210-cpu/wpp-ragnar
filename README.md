# Agente WhatsApp Barbería

Bot de WhatsApp local con dashboard de gestión, modo IA / Humano por conversación, y agendamiento automático de citas en **Barberly** via Function Calling.

## Stack

- **Next.js 15** (App Router, Turbopack, React 19)
- **Baileys 6.7+** — cliente WhatsApp Web vía QR (sin Meta API)
- **better-sqlite3 11+** — base de datos local
- **OpenAI SDK** apuntando a **OpenRouter** — LLM + Function Calling
- **Tailwind CSS 4**

## Requisitos

- Node.js 20+
- Git instalado en el PATH
- Python 3.x (para compilar `better-sqlite3`)
- VS Build Tools con "Desktop development with C++" (Windows)

## Configuración

```bash
cp .env.example .env.local
```

Edita `.env.local`:

```env
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=openai/gpt-4o-mini
BARBERLY_EMAIL=tu@email.com
BARBERLY_PASSWORD=tupassword
```

> **Modelo recomendado:** `openai/gpt-4o-mini`. Los modelos `:free` tienen límite de 50 req/día y no garantizan Function Calling.

## Uso

### Desarrollo (2 terminales)

**Terminal 1 — bot:**
```bash
npm run start:bot
```

**Terminal 2 — dashboard:**
```bash
npm run dev
```

Luego abre http://localhost:3000 y escanea el QR desde WhatsApp.

### Todo en uno (producción)
```bash
npm run build
npm run start:all
```

## Flujo de datos

```
WhatsApp → Baileys → handler.ts → SQLite → (modo AI) → OpenRouter → (tool_call?) → Barberly → respuesta
                                          ↑
                                    Dashboard (polling 2s)
                                    Next.js API Routes
```

## Estructura

```
src/
  app/
    api/               ← API routes Next.js
    page.tsx           ← ConnectionGate (QR o Dashboard)
  components/          ← React components
  lib/
    db.ts              ← SQLite + helpers
    barberly.ts        ← Login + agendamiento
    openrouter.ts      ← LLM + Function Calling
    baileys/
      client.ts        ← Conexión WhatsApp
      handler.ts       ← Mensajes entrantes + outbox
scripts/
  env-loader.ts        ← Carga .env.local (debe ser primer import)
  start-bot.ts         ← Punto de entrada del bot
data/                  ← messages.db (gitignored)
auth/                  ← Sesión Baileys (gitignored)
```

## Notas sobre Barberly

El módulo `src/lib/barberly.ts` usa los endpoints de `api.barberly.com`. Si los endpoints cambian (verificar con DevTools → Network en `portal.barberly.com`), actualizar:
- `LOGIN_PATH` — endpoint de autenticación
- `APPOINTMENT_PATH` — endpoint para crear citas

## Mejoras pendientes

- [ ] WebSocket en lugar de polling para actualizaciones en tiempo real
- [ ] Soporte para mensajes de imagen/audio en el dashboard
- [ ] Multi-número (varios WhatsApp conectados)
- [ ] Persistencia de historial para el LLM más allá de los últimos 20 mensajes
- [ ] Auth básica para el dashboard (usuario/contraseña)
- [ ] Consultar disponibilidad en Barberly antes de agendar
- [ ] Notificaciones de escritorio (Notification API)
