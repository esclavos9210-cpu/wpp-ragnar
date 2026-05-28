# Deploy en EasyPanel

## Requisitos previos
- EasyPanel instalado en tu VPS
- Acceso SSH o panel de EasyPanel
- Repo subido a GitHub (o subir los archivos directamente)

---

## Pasos

### 1. Crear nuevo proyecto en EasyPanel
1. En EasyPanel, click **+ New Project**
2. Ponle un nombre (ej: `whatsapp-claude`)

### 2. Crear servicio App
1. Dentro del proyecto, click **+ Add Service → App**
2. **Source**: GitHub repo (o "From Dockerfile" si subis los archivos directo)
3. En **Build**, seleccionar **Dockerfile**
4. Ruta del Dockerfile: `deploy easypanel/Dockerfile`

### 3. Variables de entorno
En la sección **Environment**, agregar:

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `OPENROUTER_API_KEY` | `sk-or-xxxxxxxxx` |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` |
| `BARBERLY_EMAIL` | tu email de Barberly |
| `BARBERLY_PASSWORD` | tu password de Barberly |

### 4. Volúmenes persistentes (IMPORTANTE)
Sin estos volúmenes, la sesión de WhatsApp se pierde cada vez que se reinicia el contenedor.

En la sección **Mounts**, agregar:

| Mount Path | Tipo | Descripción |
|---|---|---|
| `/app/auth` | Volume | Sesión de WhatsApp (creds de Baileys) |
| `/app/bot.db` | Volume | Base de datos SQLite |

### 5. Puerto
En la sección **Domains / Ports**:
- Puerto interno: `3000`
- Configurar el dominio o subdominio que quieras usar

### 6. Deploy
1. Click **Deploy**
2. Esperar que termine el build (~2-3 minutos la primera vez)
3. Abrir la URL del servicio
4. Escanear el QR de WhatsApp en la pantalla del dashboard

---

## Notas importantes

- **Primera vez**: siempre hay que escanear el QR. Después de eso, la sesión se guarda en el volumen `/app/auth` y no hace falta volver a escanear salvo que se cierre sesión desde el teléfono.
- **SQLite**: el archivo `bot.db` se crea automáticamente la primera vez que arranca el bot.
- **Logs**: en EasyPanel podés ver los logs en tiempo real desde el panel del servicio.
- **Reinicio**: el contenedor está configurado con `restart: unless-stopped`, así que se reinicia solo si se cae.
