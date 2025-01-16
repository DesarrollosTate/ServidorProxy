const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { execSync } = require('child_process');
require('dotenv').config();

const app = express();
app.use(cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configuración de credenciales
const networkConfig = {
    username: process.env.USUARIO_CARPETA,
    password: process.env.PASS_CARPETA,
    share: process.env.RUTA_CARPETA
};

// Función para montar el recurso de red
function connectToNetworkShare() {
    try {
        // Desmontar primero si existe una conexión previa
        try {
            execSync(`net use ${networkConfig.share} /delete /y`);
        } catch (e) {
            // Ignorar error si no estaba montado
        }
        execSync(
            `net use ${networkConfig.share} /user:${networkConfig.username} ${networkConfig.password}`,
            { stdio: 'pipe' } // Para no mostrar la contraseña en logs
        );

        console.log('Conexión a recurso de red establecida');
        return true;
    } catch (error) {
        console.error('Error al conectar con el recurso de red:', error.message);
        return false;
    }
}


// Intentar conectar al inicio
connectToNetworkShare();

// Reconectar periódicamente para mantener la conexión
setInterval(connectToNetworkShare, 1000 * 60 * 30); // Cada 30 minutos

//ENDPOINT PARA GUARDAR LA FOTO
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

//ENDPOINT PARA TRAER LA FOTO
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

// Configuración del proxy
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

app.listen(80, 'localhost', () => {
    console.log('Proxy corriendo en http://localhost/#/tate/tarjeta/fotos');
    console.log('Endpoint de búsqueda: http://localhost/api/fotos/:dni');
});

process.on('uncaughtException', (err) => {
    console.error('Error no manejado:', err);
});