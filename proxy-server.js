const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { execSync } = require('child_process');
const net = require('net');
require('dotenv').config();

const app = express();
app.use(cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CONFIGURACIÓN DE CREDENCIALES PARA ACCEDER A LAS CARPETAS
const networkConfig = {
    username: process.env.USUARIO_CARPETA,
    password: process.env.PASS_CARPETA,
    share: process.env.RUTA_CARPETA
};

//VERIFICAMOS SI EL PUERTO ESTÁ DISPONIBLE
const isPortAvailable = (port) => {
    //CREAMOS LA PROMESA
    return new Promise((resolve) => {
        //CREAMOS UN SERVIDOR
        const server = net.createServer();
        
        //MANEJA EL ERROR DEL SERVIDOR
        server.once('error', () => {
            resolve(false); //DEVUELVE FALSE
        });
        
        //ESCUCHANDO EL SERVIDOR
        server.once('listening', () => {
            server.close(); //CIERRA EL SERVIDOR
            resolve(true); //DEVUELVE TRUE
        });
        
        //INTENTA ESCUCHAR EL PUERTO ESPECIFICADO
        server.listen(port);
    });
};

//FUNCIÓN PARA BUSCAR UN PUERTO DISPONIBLE
const findAvailablePort = async (startPort, maxPort = 9000) => {
    //ITERA SOBRE EL PUERTO DESDE EL PRIMERO HASTA EL MÁXIMO DISPONIBLE
    for (let port = startPort; port <= maxPort; port++) {
        //LLAMA A LA FUNCIÓN PARA VERIFICAR SI EL PUERTO ESTÁ DISPONIBLE
        if (await isPortAvailable(port)) {
            return port; //DEVUELVE EL PUERTO DISPONIBLE SI ES TRUE
        }
    }
    //RETORNA EL ERROR
    throw new Error('No se encontró ningún puerto disponible');
};

//INICIA EL SERVIDOR BSUCANDO EL PUERTO
const startServer = async (startPort = 80, maxPort = 9000) => {
    try {
        const port = await findAvailablePort(startPort, maxPort); //BUSCAMOS PUERTO DISPONIBLE
        //UNA VEZ LO ENCUENTRA, ESCUCHAMOS EL SERVIDOR CON LA CONFIGURACIÓN
        const server = app.listen(port, 'localhost', () => {
            console.log(`Servidor iniciado exitosamente en el puerto ${port}`);
            console.log(`Proxy corriendo en http://localhost:${port}/#/tate/tarjeta/fotos`);
        });

        //MANEJO DE ERRORES
        server.on('error', async (err) => {
            //SI EL PUERTO YA ESTÁ EN USO
            if (err.code === 'EADDRINUSE') {
                console.error(`El puerto ${port} está en uso. Intentando en el siguiente puerto...`);
                startServer(port + 1, maxPort); // INTENTA CON EL SIGUIENTE PUERTO
            }   //OTRO ERROR
                else {
                console.error('Error al iniciar el servidor:', err);
                process.exit(1);
            }
        });
    } catch (error) {
        //ERROR AL BUSCAR DIRECTAMENTE
        console.error('Error al buscar un puerto disponible:', error);
        process.exit(1);
    }
};

//FUNCIÓN PARA CONECTARNOS A LA CARPETA
function connectToNetworkShare() {
    try {
        //INTENTAMOS DESMONTAR
        try {
            execSync(`net use ${networkConfig.share} /delete /y`);
        } catch (e) {} //IGNORAMOS SI NO ESTABA MONTADO
        //MONTAMOS LA CONEXIÓN
        execSync(
            `net use ${networkConfig.share} /user:${networkConfig.username} ${networkConfig.password}`,
            { stdio: 'pipe' } //PARA NO MOSTRAR LA CONTRASEÑA EN LOS LOGS
        );

        console.log('Conexión a recurso de red establecida');
        return true;
    } catch (error) {
        console.error('Error al conectar con el recurso de red:', error.message);
        return false;
    }
}

//INICIA EL SERVIDOR Y CONECTA EL RECURSO DE RED
startServer();
connectToNetworkShare();

//RECONECTAR PERIÓDICAMENTE PARA MANTENER LA CONEXIÓN
setInterval(connectToNetworkShare, 1000 * 60 * 30); //30 MIN


//*<--------------------------------------------------------------------------------------------------->
//*ENPOINTS

//? GUARDAR LA FOTO X DNI
app.post('/api/fotos/:dni', (req, res) => {
    const dni = req.params.dni;
    const { fotoBase64 } = req.body;
    
    // Validaciones
    if (!dni || dni.trim().length === 0) {
        return res.status(400).json({ 
            error: 'DNI no válido' 
        });
    }

    if (!fotoBase64) {
        return res.status(400).json({ 
            error: 'No se proporcionó la imagen' 
        });
    }

    // Verificar que es una imagen base64 válida
    if (!fotoBase64.match(/^data:image\/(png|jpeg|jpg|gif);base64,/)) {
        return res.status(400).json({ 
            error: 'Formato de imagen no válido' 
        });
    }

    // Verificar conexión antes de acceder
    if (!fs.existsSync(networkConfig.share)) {
        if (!connectToNetworkShare()) {
            return res.status(500).json({
                error: 'Error de conexión con el recurso de red'
            });
        }
    }

    try {
        // Extraer la parte de datos del base64
        const base64Data = fotoBase64.replace(/^data:image\/\w+;base64,/, '');
        
        // Crear nombre de archivo con timestamp para evitar duplicados
        const fileName = `DNI${dni}.jpg`;
        const filePath = path.join(networkConfig.share, fileName);

        // Guardar el archivo
        fs.writeFile(filePath, base64Data, 'base64', (err) => {
            if (err) {
                console.error('Error al guardar la foto:', err);
                return res.status(500).json({
                    error: 'Error al guardar la foto',
                    detalle: err.message
                });
            }

            res.json({
                mensaje: 'Foto guardada exitosamente',
                nombreArchivo: fileName
            });
        });

    } catch (error) {
        console.error('Error al procesar la foto:', error);
        res.status(500).json({
            error: 'Error al procesar la foto',
            detalle: error.message
        });
    }
});

//* OBTENER LA FOTO X DNI
app.get('/api/fotos/:dni', (req, res) => {
    const dni = req.params.dni;
    
    if (!dni || dni.trim().length === 0) {
        return res.status(400).json({ 
            error: 'DNI no válido' 
        });
    }

    // Verificar conexión antes de acceder
    if (!fs.existsSync(networkConfig.share)) {
        // Intentar reconectar si no está accesible
        if (!connectToNetworkShare()) {
            return res.status(500).json({
                error: 'Error de conexión con el recurso de red'
            });
        }
    }

    fs.readdir(networkConfig.share, (err, archivos) => {
        if (err) {
            console.error('Error al leer el directorio:', err);
            return res.status(500).json({
                error: 'Error al acceder al directorio de fotos',
                detalle: err.message
            });
        }

        const fotoEncontrada = archivos.find(archivo => {
            const esImagen = /\.(jpg|jpeg|png|gif)$/i.test(archivo);
            const contieneDNI = archivo.toLowerCase().includes(dni.toLowerCase());
            return esImagen && contieneDNI;
        });

        if (!fotoEncontrada) {
            return res.json(null);;
        }

        const rutaCompleta = path.join(networkConfig.share, fotoEncontrada);
        fs.readFile(rutaCompleta, (err, data) => {
            if (err) {
                console.error('Error al leer el archivo:', err);
                return res.status(500).json({
                    error: 'Error al procesar la foto',
                    detalle: err.message
                });
            }

            res.json({
                nombre: fotoEncontrada,
                archivo: data.toString('base64')
            });
        });
    });
});

//CONFIGURACIÓN DEL PROXY
app.use('/', createProxyMiddleware({
    target: process.env.RUTA_APP,
    changeOrigin: true,
    ws: true,
    pathRewrite: {
        '^/tate/tarjeta/fotos': '/tate/tarjeta/fotos'
    },
    onError: (err, req, res) => {
        console.error('Error en el proxy:', err);
        res.status(500).send('Proxy error');
    }
}));

app.use(express.json());

process.on('uncaughtException', (err) => {
    console.error('Error no manejado:', err);
});