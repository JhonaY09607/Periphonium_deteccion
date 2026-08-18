//config-------------------------------------------------------------------------------
module.exports = {
    // Grupos de WhatsApp usados para el perifoneo general (audio/SOS) y para
    // recibir las notificaciones de intrusión enviadas por main.py (Flask).
    gruposWhatsApp: [
        {
            nombre: 'Perifoneo CCE',
            id: '120363404781569805@g.us',
            // Esta misma Raspberry corre a la vez Flask (puerto 5000) y este sidecar,
            // por eso apunta a localhost. Agrega más IPs si reenvías a otros equipos.
            raspberryIPs: ['127.0.0.1']
        }
    ],
    palabrasClaveSOS: ['SOS', 'AYUDA', 'EMERGENCIA', 'INCENDIO', 'ALERTA'],

    // Puerto donde este sidecar escucha las notificaciones internas de main.py
    NOTIFY_PORT: 3001,

    // Credenciales SMTP opcionales para avisar si WhatsApp Web se desconecta.
    // Configúralas como variables de entorno, nunca las escribas aquí en texto plano.
    SMTP_USER: process.env.CGB_SMTP_USER || '',
    SMTP_PASS: process.env.CGB_SMTP_PASS || '',
    SMTP_TO: process.env.CGB_SMTP_TO || ''
};
//-------------------------------------------------------------------------------------
