const fs = require('fs/promises');
const axios = require('axios');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const FormData = require('form-data');
const qrcode = require('qrcode-terminal');
const nodemailer = require('nodemailer');
const player = require('play-sound')();
const { gruposWhatsApp, palabrasClaveSOS } = require('./config.js');
const MEDIA_DIR = path.join(__dirname, 'media');

// Crear directorio media si no existe
fs.mkdir(MEDIA_DIR, { recursive: true }).catch(console.error);

// Eliminar archivos en media/ con más de 1 día
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

// Ejecutar cada hora
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

// Configurar transporte SMTP
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'jonathanyungan6@gmail.com',
        pass: 'qrgu ifpj wuxe tlqw' // contraseña de aplicación
    }
});

// Envío de correo en caso de desconexión
async function enviarCorreoDesconexion(motivo) {
    const mailOptions = {
        from: 'jonathanyungan6@gmail.com',
        to: 'jhonayungan@gmail.com',
        subject: 'WhatsApp Web Desconectado',
        text: `El cliente se ha desconectado. Motivo: ${motivo}`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Correo enviado a jhonayungan@gmail.com');
    } catch (error) {
        console.error('Error al enviar correo:', error);
    }
}

// Enviar audio a API Flask
async function send_audio(api, filename) {
    try {
        const filePath = path.join(MEDIA_DIR, filename);
        const fileBuffer = await fs.readFile(filePath);
        const form = new FormData();
        form.append('file', fileBuffer, filename);

        const response = await axios.post(api, form, {
            headers: form.getHeaders()
        });

        console.log('Audio enviado correctamente a Flask:', response.data);
    } catch (error) {
        console.error('Error al enviar el audio a Flask:', error.message);
    }
}

// Cola para reproducir audios uno a uno
const audioQueue = [];
let isPlaying = false;

function playNextAudio() {
    if (audioQueue.length === 0) {
        isPlaying = false;
        return;
    }
    isPlaying = true;
    const nextAudio = audioQueue.shift();

    player.play(nextAudio, function (err) {
        if (err) {
            console.error('Error reproduciendo audio:', err);
        }
        playNextAudio();
    });
}

function enqueueAudio(filename) {
    audioQueue.push(filename);
    if (!isPlaying) {
        playNextAudio();
    }
}

// Procesar mensajes multimedia
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

        if (extension === 'ogg' || media.mimetype.startsWith('audio/')) {
            console.log(`Encolando audio para reproducir: ${filename}`);

            // enqueueAudio(path.join(MEDIA_DIR, filename));  // si quieres reproducir local

            // ✅ Ahora recibe las IPs como parámetro
            await Promise.all(
                raspberryIPs.map(ip => {
                    const url = `http://${ip}:5000/upload`;
                    return send_audio(url, filename);
                })
            );
        }
    } catch (error) {
        console.error(`Error procesando multimedia (${direction}):`, error);
    }
}

// Procesar mensajes entrantes o salientes
async function handleMessage(msg, direction) {
    console.log(`MENSAJE ${direction.toUpperCase()}:`);
    console.log(`De: ${direction === 'incoming' ? msg.from : msg.to}`);

    for (const grupo of gruposWhatsApp) {
        if (msg.to === grupo.id || msg.from === grupo.id) {
            try {
                if (msg.hasMedia) {
                    console.log(`Tipo multimedia: ${msg.mimetype}`);
                    await handleMedia(msg, grupo.raspberryIPs, direction);
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

// Eventos del cliente
client.on('message', msg => handleMessage(msg, 'incoming'));
client.on('message_create', msg => {
    if (msg.fromMe) {
        handleMessage(msg, 'outgoing');
    }
});

client.on('qr', qr => {
    console.log('Escanea este QR con WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => console.log('Cliente listo'));
client.on('auth_failure', msg => console.error('Fallo de autenticación:', msg));
client.on('disconnected', async reason => {
    console.log('Desconectado:', reason);
    await enviarCorreoDesconexion(reason);
});

process.on('unhandledRejection', error => {
    console.error('Error no manejado:', error);
});

// Inicializar cliente
client.initialize().catch(console.error);

// Cierre limpio
const cleanChr = async () => {
    console.log('Cerrando cliente...');
    await client.destroy();
};
process.on('SIGINT', cleanChr);
process.on('SIGTERM', cleanChr);
