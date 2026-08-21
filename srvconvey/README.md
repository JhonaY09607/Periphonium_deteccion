### Preinstalación

1. Clona o copia el proyecto en tu Raspberry Pi 4 dentro de la carpeta que desees (por ejemplo: `/home/tgslo/srvconvey`).

2. Una vez copiado, otorga permisos de ejecución al archivo **install_automatic.sh** con el siguiente comando:  
   `$ chmod +x install_automatic.sh`

3. Ejecuta el archivo de instalación automática con el siguiente comando:  
   `$ ./install_automatic.sh`

   Este script instalará todas las dependencias necesarias y configurará los archivos base para el servicio de perifoneo.

---
### Instalación del servicio de perifoneo en Raspberry Pi 4

1. Una vez finalizada la instalación, ejecuta el servicio manualmente con el siguiente comando:  
   `$ node index.js`

2. Cuando se ejecute el script, aparecerá un **código QR** en la terminal.  
   Escanéalo con tu **WhatsApp personal** desde tu celular.

3. Una vez vinculado, comenzarán a mostrarse logs en pantalla.  
   Entre ellos aparecerá el **ID del grupo** donde se realizará el perifoneo (por ejemplo:  
   `120363401669840464@g.us`).  
   Guarda este ID, ya que será necesario para la configuración.

4. Para detener la ejecución del bot, presiona:  
   `Ctrl + X`


5. Buscamos la IP de la Raspberry ya instalada, usa este comando para ver la ip:
   `$ ip a`

6. Entre los datos que nos van a aparer vamos a buscar la ip (por ejemplo: `192.168.100.101`).
   Y guardamos la ip para la siguiente configuracion. 

---
### Configuración del archivo config.js

1. Abre el archivo de configuración con:  
   `$ nano config.js`

2. Reemplaza los siguientes valores con la información correspondiente al grupo e IP de tu Raspberry Pi:
   ```js
   nombre: 'Tglabs', 
   id: '120363401669840464@g.us',
   raspberryIPs: ["192.168.100.101"]
---
**HABILITACIÓN PERMANENTE DEL SERVICIO**

Una vez verificado que el servicio funciona correctamente, habilítalo para que se ejecute automáticamente al iniciar la Raspberry Pi con:

`sudo systemctl enable index.server.service`

Reinicia la Raspberry Pi para aplicar los cambios con:

`sudo reboot`

[Diagrama de conexiones](./Perifoneo.drawio.png)

Después del reinicio, el servicio index.server.service se iniciará automáticamente y quedará listo para operar.
