# Deploy en EasyPanel

## Cómo funciona el build
EasyPanel detecta automáticamente el archivo `nixpacks.toml` en la raíz y lo usa para construir la imagen. No es necesario configurar nada especial en la sección Build.

---

## Pasos

### 1. Crear proyecto en EasyPanel
1. Click en **+ New Project** → ponerle nombre (ej: `wpp-agent`)

### 2. Crear servicio App
1. Dentro del proyecto → **+ Add Service → App**
2. **Source**: seleccionar **Github**
3. Ingresar Owner: `esclavos9210-cpu` y Repository: `whatsapp-ragnar`
4. Branch: `main`
5. Si el repo es privado: ir a **Settings** de EasyPanel y configurar un GitHub Token

### 3. Variables de entorno
En la sección **Environment** del servicio, agregar exactamente estas variables:

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `OPENAI_API_KEY` | `sk-proj-xxxxxxxxx` (tu clave de OpenAI) |
| `OPENAI_MODEL` | `gpt-4o-mini` |
| `BARBERLY_EMAIL` | tu email de Barberly |
| `BARBERLY_PASSWORD` | tu password de Barberly |

> **Importante:** El modelo debe ser `gpt-4o-mini` sin ningún prefijo. No usar `openai/gpt-4o-mini`.

### 4. Volúmenes persistentes
Sin estos volúmenes la sesión de WhatsApp y la base de datos se pierden al reiniciar.

En la sección **Mounts** del servicio agregar:

| Mount Path | Descripción |
|---|---|
| `/app/auth` | Sesión de WhatsApp (archivos de Baileys) |
| `/app/data` | Base de datos SQLite (`messages.db`) |

> **Importante:** Ambos deben ser directorios, no archivos.

### 5. Dominio y puerto
En la sección **Domains**:
- Puerto interno: `3000`
- Configurar el dominio o subdominio deseado

### 6. Deploy
1. Click en **Deploy** (botón verde)
2. Esperar que termine el build (~2-3 minutos la primera vez)
3. Abrir la URL del servicio
4. Escanear el QR de WhatsApp desde la pantalla del dashboard

---

## Notas importantes

- **Primera vez siempre hay que escanear el QR.** Después la sesión queda guardada en el volumen `/app/auth`.
- **Si el bot deja de responder**, verificar en la consola del contenedor que `OPENAI_API_KEY` esté seteada: `printenv OPENAI_API_KEY`
- **Si el QR no aparece**, puede haber una sesión vieja inválida en `/app/auth`. Desde la consola del contenedor: `rm -rf /app/auth/*` y reiniciar el servicio.
- **Logs en tiempo real**: en el panel del servicio, usar el ícono de consola (`>_`) para acceder a la terminal del contenedor.
