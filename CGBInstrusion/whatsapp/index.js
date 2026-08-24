const fs = require('fs/promises');
const http = require('http');
const axios = require('axios');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const FormData = require('form-data');
const qrcode = require('qrcode-terminal');
const {
    gruposWhatsApp,
    palabrasClaveSOS,
    NOTIFY_PORT,
    SMTP_USER,
    SMTP_PASS,
    SMTP_TO
} = require('./config.js');

const MEDIA_DIR = path.join(__dirname, 'media');
fs.mkdir(MEDIA_DIR, { recursive: true }).catch(console.error);

// Eliminar audios de más de 1 día
async function eliminarAudiosAntiguos() {
    try {
        const files = await fs.readdir(MEDIA_DIR);
        const ahora = Date.now();
        const UN_DIA_MS = 24 * 60 * 60 * 1000;

        for (const file of files) {
            const filePath = path.join(MEDIA_DIR, file);
            const stats = await fs.stat(filePath);
            if (ahora - stats.mtimeMs > UN_DIA_MS) {
                await fs.unlink(filePath);
                console.log(`Archivo eliminado por antigüedad: ${file}`);
            }
        }
    } catch (error) {
        console.error('Error al eliminar audios antiguos:', error);
    }
}
setInterval(eliminarAudiosAntiguos, 60 * 60 * 1000);

// Cliente de WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: '/usr/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote'
        ]
    }
});

// Aviso por correo si el cliente se desconecta (opcional, requiere CGB_SMTP_*)
async function enviarCorreoDesconexion(motivo) {
    if (!SMTP_USER || !SMTP_PASS || !SMTP_TO) return;
    try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: SMTP_USER, pass: SMTP_PASS }
        });
        await transporter.sendMail({
            from: SMTP_USER,
            to: SMTP_TO,
            subject: 'WhatsApp Web Desconectado',
            text: `El cliente se ha desconectado. Motivo: ${motivo}`
        });
        console.log(`Correo de desconexión enviado a ${SMTP_TO}`);
    } catch (error) {
        console.error('Error al enviar correo:', error);
    }
}

// Enviar audio a la API Flask (main.py) de la Raspberry destino
async function send_audio(api, filename) {
    try {
        const filePath = path.join(MEDIA_DIR, filename);
        const fileBuffer = await fs.readFile(filePath);
        const form = new FormData();
        form.append('file', fileBuffer, filename);

        const response = await axios.post(api, form, { headers: form.getHeaders() });
        console.log('Audio enviado correctamente a Flask:', response.data);
    } catch (error) {
        console.error('Error al enviar el audio a Flask:', error.message);
    }
}

// Procesar mensajes multimedia del grupo (perifoneo general)
async function handleMedia(msg, raspberryIPs, direction = 'incoming') {
    try {
        const media = await msg.downloadMedia();
        if (!media) return;

        if (!media.mimetype || !media.mimetype.startsWith('audio/')) {
            console.log(`Archivo ignorado (no es audio): ${media.mimetype}`);
            return;
        }

        const extension = media.mimetype.split('/')[1].split(';')[0];
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = media.filename || `${direction}_${timestamp}.${extension}`;

        if (!media.data || media.data.length === 0) {
            throw new Error('Datos multimedia vacíos');
        }

        await fs.writeFile(path.join(MEDIA_DIR, filename), media.data, 'base64');
        console.log(`Archivo de audio guardado: ${filename}`);
        console.log(`Encolando audio para reproducir: ${filename}`);

        await Promise.all(
            raspberryIPs.map(ip => send_audio(`http://${ip}:5000/upload`, filename))
        );
    } catch (error) {
        console.error(`Error procesando multimedia (${direction}):`, error);
    }
}

// Procesar mensajes de texto/multimedia entrantes o salientes del grupo
async function handleMessage(msg, direction) {
    console.log(`MENSAJE ${direction.toUpperCase()}:`);
    console.log(`De: ${direction === 'incoming' ? msg.from : msg.to}`);

    for (const grupo of gruposWhatsApp) {
        if (msg.to === grupo.id || msg.from === grupo.id) {
            try {
                // Solo se descargan audios/notas de voz (perifoneo). Se ignoran fotos,
                // videos, stickers, etc. -- incluye las fotos que el propio bot manda
                // con las alertas de intrusión, que no deben reenviarse a Flask.
                if (msg.hasMedia && ['audio', 'ptt'].includes(msg.type)) {
                    console.log(`Tipo multimedia: ${msg.type}`);
                    await handleMedia(msg, grupo.raspberryIPs, direction);
                } else if (msg.hasMedia) {
                    console.log(`Multimedia ignorada (tipo: ${msg.type})`);
                } else {
                    const texto = msg.body.trim().toUpperCase();
                    console.log(`Texto: ${texto}`);

                    if (palabrasClaveSOS.includes(texto)) {
                        await Promise.all(
                            grupo.raspberryIPs.map(async ip => {
                                try {
                                    const res = await axios.post(`http://${ip}:5000/text`, { text: texto });
                                    console.log(`Palabra clave "${texto}" enviada a ${ip}:`, res.data);
                                } catch (err) {
                                    console.error(`Error enviando "${texto}" a ${ip}:`, err.message);
                                }
                            })
                        );
                    }
                }
            } catch (error) {
                console.error(`Error procesando mensaje para ${grupo.nombre} (${direction}):`, error);
            }
        }
    }
    console.log('--------------------------');
}

client.on('message', msg => handleMessage(msg, 'incoming'));
client.on('message_create', msg => {
    if (msg.fromMe) handleMessage(msg, 'outgoing');
});

client.on('qr', qr => {
    console.log('Escanea este QR con WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => console.log('Cliente de WhatsApp listo'));
client.on('auth_failure', msg => console.error('Fallo de autenticación:', msg));
client.on('disconnected', async reason => {
    console.log('Desconectado:', reason);
    await enviarCorreoDesconexion(reason);
});

process.on('unhandledRejection', error => {
    console.error('Error no manejado:', error);
});

client.initialize().catch(console.error);

// ── Servidor local de notificaciones ──────────────────────────────────────────
// main.py (Flask) llama a POST /notify cuando la cámara detecta una intrusión,
// para que este sidecar envíe el aviso a los grupos de WhatsApp configurados.

async function notificarGrupos(mensaje, media) {
    await Promise.all(
        gruposWhatsApp.map(async grupo => {
            try {
                if (media) {
                    await client.sendMessage(grupo.id, media, { caption: mensaje });
                } else {
                    await client.sendMessage(grupo.id, mensaje);
                }
                console.log(`Notificación enviada al grupo ${grupo.nombre}`);
            } catch (err) {
                console.error(`Error enviando notificación al grupo ${grupo.nombre}:`, err.message);
            }
        })
    );
}

const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
    }

    if (req.method === 'POST' && req.url === '/notify') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const { mensaje, foto_base64 } = JSON.parse(body || '{}');
                if (!mensaje) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Falta el campo "mensaje"' }));
                    return;
                }
                const media = foto_base64
                    ? new MessageMedia('image/jpeg', foto_base64, 'intrusion.jpg')
                    : null;
                await notificarGrupos(mensaje, media);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Notificación enviada' }));
            } catch (error) {
                console.error('Error procesando /notify:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
        return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(NOTIFY_PORT, '127.0.0.1', () => {
    console.log(`Servidor de notificaciones escuchando en 127.0.0.1:${NOTIFY_PORT}`);
});

// Cierre limpio
const cleanExit = async () => {
    console.log('Cerrando cliente...');
    server.close();
    await client.destroy();
    process.exit(0);
};
process.on('SIGINT', cleanExit);
process.on('SIGTERM', cleanExit);
