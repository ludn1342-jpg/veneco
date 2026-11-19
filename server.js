const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Lee la URL del backend desde las variables de entorno de Render
const BACKEND_URL = process.env.BACKEND_URL || 'https://backvenecol.onrender.com';

// 🔥 CAMBIO AQUÍ: Sirve archivos estáticos desde la RAÍZ (__dirname), no desde /public
app.use(express.static(__dirname));

// Redirige todo lo que vaya a /api/... hacia tu backend
app.use('/api', createProxyMiddleware({
    target: BACKEND_URL,
    changeOrigin: true,
    secure: false
}));

// Cualquier otra ruta carga tu pago.html (que está en la raíz)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'pago.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Frontend corriendo en puerto ${PORT}`);
});
