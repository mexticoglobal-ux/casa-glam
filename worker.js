const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Pin",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=UTF-8",
    },
  });
}

function text(body, status = 200) {
  return new Response(body, { status, headers: cors });
}

async function getBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function pick(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const str = String(value).trim();
    if (str !== "") return str;
  }
  return "";
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return Number(fallback) || 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value)
    .replace(/[₡,$\s]/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : (Number(fallback) || 0);
}

function roundMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function normalizePaymentMethod(value) {
  const raw = pick(value, "Efectivo");
  const lower = raw.toLowerCase();
  if (lower.includes("sinpe")) return "SINPE";
  if (lower.includes("tarjeta")) return "Tarjeta";
  if (lower.includes("transfer")) return "Transferencia";
  return "Efectivo";
}

function normalizeAppointmentStatus(value) {
  const raw = pick(value, "Pendiente");
  const valid = new Set(["Pendiente", "Confirmada", "Atendida", "Cancelada", "Reprogramada"]);
  for (const option of valid) {
    if (raw.toLowerCase() === option.toLowerCase()) return option;
  }
  return "Pendiente";
}

function normalizePaymentStatus(value, paymentMethod, amountPaid, totalAmount) {
  const raw = pick(value, "");
  const valid = ["Cobrado", "Pendiente", "Pendiente SINPE", "Sin cobro", "Cobrado parcial", "Cancelado"];
  for (const option of valid) {
    if (raw.toLowerCase() === option.toLowerCase()) return option;
  }

  if (paymentMethod === "SINPE") {
    if (amountPaid >= totalAmount && totalAmount > 0) return "Cobrado";
    if (amountPaid > 0 && amountPaid < totalAmount) return "Pendiente SINPE";
    return "Pendiente SINPE";
  }

  if (amountPaid >= totalAmount && totalAmount > 0) return "Cobrado";
  if (amountPaid > 0 && amountPaid < totalAmount) return "Cobrado parcial";
  return "Sin cobro";
}

function isAdmin(request, env, data = {}) {
  const pin =
    request.headers.get("X-Admin-Pin") ||
    data.pin ||
    data.adminPin ||
    data.admin_pin ||
    "";

  return !!env.ADMIN_PIN && String(pin) === String(env.ADMIN_PIN);
}

async function getSettings(env) {
  const result = await env.DB
    .prepare("SELECT key, value FROM settings")
    .all();

  const settings = {};
  for (const row of result.results || []) {
    settings[row.key] = row.value;
  }
  return settings;
}

async function getProfessionals(env, onlyActive = true) {
  const sql = onlyActive
    ? `SELECT id, name, active, sort_order
       FROM professionals
       WHERE active = 1
       ORDER BY sort_order, name`
    : `SELECT id, name, active, sort_order
       FROM professionals
       ORDER BY sort_order, name`;

  const result = await env.DB.prepare(sql).all();
  return result.results || [];
}

async function getServices(env, onlyActive = true) {
  const sql = onlyActive
    ? `SELECT id, name, active, sort_order
       FROM services
       WHERE active = 1
       ORDER BY sort_order, name`
    : `SELECT id, name, active, sort_order
       FROM services
       ORDER BY sort_order, name`;

  const result = await env.DB.prepare(sql).all();
  return result.results || [];
}

async function ensureSchema(env) {
  const tables = ["appointments", "clients", "client_followups"];
  for (const table of tables) {
    try {
      const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
      const cols = new Set((info.results || []).map((row) => row.name));
      const alters = [];
      if (table === "appointments") {
        if (!cols.has("total_amount")) alters.push("ALTER TABLE appointments ADD COLUMN total_amount REAL NOT NULL DEFAULT 0");
        if (!cols.has("amount_paid")) alters.push("ALTER TABLE appointments ADD COLUMN amount_paid REAL NOT NULL DEFAULT 0");
        if (!cols.has("payment_method")) alters.push("ALTER TABLE appointments ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'Efectivo'");
        if (!cols.has("payment_status")) alters.push("ALTER TABLE appointments ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'Sin cobro'");
        if (!cols.has("payment_note")) alters.push("ALTER TABLE appointments ADD COLUMN payment_note TEXT NOT NULL DEFAULT ''");
        if (!cols.has("payment_updated_at")) alters.push("ALTER TABLE appointments ADD COLUMN payment_updated_at TEXT");
      }
      for (const sql of alters) {
        try {
          await env.DB.prepare(sql).run();
        } catch (err) {
          console.warn("Schema migration skipped:", sql, err?.message || err);
        }
      }
    } catch (err) {
      console.warn("ensureSchema warning:", table, err?.message || err);
    }
  }
}

function parseQueryFilters(url) {
  return {
    q: pick(url.searchParams.get("q")),
    status: pick(url.searchParams.get("status")),
    paymentStatus: pick(url.searchParams.get("payment_status"), url.searchParams.get("paymentStatus")),
    paymentMethod: pick(url.searchParams.get("payment_method"), url.searchParams.get("paymentMethod")),
    date: pick(url.searchParams.get("date")),
  };
}

function buildPaymentPayload(data = {}, current = {}) {
  const totalAmount = toNumber(
    pick(
      data.total_amount,
      data.totalAmount,
      data.total,
      data.amount_total,
      data.price,
      data.costo,
      current.total_amount
    ),
    0
  );

  const amountPaid = toNumber(
    pick(
      data.amount_paid,
      data.amountPaid,
      data.paid,
      data.deposit,
      data.cobrado,
      data.montoCobrado,
      data.monto_cobrado,
      current.amount_paid
    ),
    0
  );

  const paymentMethod = normalizePaymentMethod(
    pick(
      data.payment_method,
      data.paymentMethod,
      data.formaPago,
      data.forma_de_pago,
      current.payment_method
    )
  );

  const paymentStatus = normalizePaymentStatus(
    pick(data.payment_status, data.paymentStatus, data.estadoCobro, current.payment_status),
    paymentMethod,
    amountPaid,
    totalAmount
  );

  const balance = roundMoney(Math.max(0, totalAmount - amountPaid));

  return {
    totalAmount: roundMoney(totalAmount),
    amountPaid: roundMoney(amountPaid),
    paymentMethod,
    paymentStatus,
    balance,
    paymentNote: pick(data.payment_note, data.paymentNote, current.payment_note),
  };
}

function buildAppointmentUpdate(data = {}, current = {}) {
  const status = normalizeAppointmentStatus(
    pick(data.status, data.appointmentStatus, data.estado, data.appointment_status, current.status)
  );
  const payment = buildPaymentPayload(data, current);
  return { status, ...payment };
}

async function fetchAppointments(env, { q = "", status = "", paymentStatus = "", paymentMethod = "", date = "", limit = 250 } = {}) {
  const filters = [];
  const binds = [];

  if (q) {
    filters.push("(c.name LIKE ? OR c.phone LIKE ? OR a.service LIKE ? OR a.professional LIKE ? OR a.notes LIKE ?)");
    const like = `%${q}%`;
    binds.push(like, like, like, like, like);
  }
  if (status) {
    filters.push("a.status = ?");
    binds.push(status);
  }
  if (paymentStatus) {
    filters.push("a.payment_status = ?");
    binds.push(paymentStatus);
  }
  if (paymentMethod) {
    filters.push("a.payment_method = ?");
    binds.push(paymentMethod);
  }
  if (date) {
    filters.push("a.date = ?");
    binds.push(date);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const sql = `
    SELECT
      a.id,
      c.name,
      c.phone,
      a.service,
      a.professional,
      a.date,
      a.time,
      a.notes,
      a.status,
      a.total_amount,
      a.amount_paid,
      a.payment_method,
      a.payment_status,
      a.payment_note,
      a.payment_updated_at,
      a.created_at,
      a.updated_at
    FROM appointments a
    JOIN clients c
      ON c.id = a.client_id
    ${where}
    ORDER BY a.date ASC, a.time ASC
    LIMIT ${Number(limit) || 250}
  `;

  const result = await env.DB.prepare(sql).bind(...binds).all();
  return result.results || [];
}

function summarizePayments(rows) {
  const summary = {
    totalAmount: 0,
    totalPaid: 0,
    totalBalance: 0,
    paidCash: 0,
    paidSinpe: 0,
    pendingSinpe: 0,
  };

  for (const row of rows) {
    const total = toNumber(row.total_amount);
    const paid = toNumber(row.amount_paid);
    const balance = Math.max(0, total - paid);

    summary.totalAmount += total;
    summary.totalPaid += paid;
    summary.totalBalance += balance;

    const method = normalizePaymentMethod(row.payment_method);
    const payStatus = String(row.payment_status || "").toLowerCase();

    if (method === "SINPE" && payStatus === "cobrado") {
      summary.paidSinpe += paid;
    } else if (method === "Efectivo" && payStatus === "cobrado") {
      summary.paidCash += paid;
    } else if (method === "SINPE" && payStatus === "pendiente sinpe") {
      summary.pendingSinpe += balance || total || 0;
    }
  }

  return {
    totalAmount: roundMoney(summary.totalAmount),
    totalPaid: roundMoney(summary.totalPaid),
    totalBalance: roundMoney(summary.totalBalance),
    paidCash: roundMoney(summary.paidCash),
    paidSinpe: roundMoney(summary.paidSinpe),
    pendingSinpe: roundMoney(summary.pendingSinpe),
  };
}

async function getClientById(env, id) {
  return await env.DB
    .prepare(
      `
      SELECT id, name, phone, created_at, updated_at
      FROM clients
      WHERE id = ?
    `
    )
    .bind(id)
    .first();
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    await ensureSchema(env);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (path === "/" || path === "/api") {
        return json({
          ok: true,
          service: "Casa Glam API",
          database: !!env.DB,
          adminPinConfigured: !!env.ADMIN_PIN,
        });
      }

      if ((path === "/api/admin" || path === "/api/admin/login" || path === "/admin/login") && request.method === "POST") {
        const data = await getBody(request);
        if (!isAdmin(request, env, data)) {
          return json({ ok: false, error: "PIN incorrecto" }, 401);
        }
        return json({ ok: true, authenticated: true });
      }

      if (path === "/api/config" && request.method === "GET") {
        const settings = await getSettings(env);
        const professionals = await getProfessionals(env, true);
        const services = await getServices(env, true);
        return json({ ok: true, settings, professionals, services });
      }

      if ((path === "/api/admin/config" || path === "/api/config") && request.method === "PUT") {
        const data = await getBody(request);
        if (!isAdmin(request, env, data)) {
          return json({ ok: false, error: "No autorizado" }, 401);
        }

        const open = String(pick(data.open, data.settings?.open, "09:00")).trim();
        const close = String(pick(data.close, data.settings?.close, "18:00")).trim();
        const slot = String(pick(data.slot, data.settings?.slot, "60")).trim();

        const allowedSlots = ["30", "60", "90"];
        if (!allowedSlots.includes(slot)) {
          return json({ ok: false, error: "La duración debe ser 30, 60 o 90 minutos" }, 400);
        }

        await env.DB.prepare(`
          INSERT INTO settings(key,value)
          VALUES ('open',?)
          ON CONFLICT(key)
          DO UPDATE SET value = excluded.value
        `).bind(open).run();

        await env.DB.prepare(`
          INSERT INTO settings(key,value)
          VALUES ('close',?)
          ON CONFLICT(key)
          DO UPDATE SET value = excluded.value
        `).bind(close).run();

        await env.DB.prepare(`
          INSERT INTO settings(key,value)
          VALUES ('slot',?)
          ON CONFLICT(key)
          DO UPDATE SET value = excluded.value
        `).bind(slot).run();

        if (Array.isArray(data.professionals)) {
          const cleanProfessionals = [...new Set(data.professionals.map((x) => typeof x === "string" ? x.trim() : String(x.name || "").trim()).filter(Boolean))];
          await env.DB.prepare("UPDATE professionals SET active = 0").run();
          let order = 1;
          for (const name of cleanProfessionals) {
            await env.DB.prepare(`
              INSERT INTO professionals (name, active, sort_order)
              VALUES (?, 1, ?)
              ON CONFLICT(name)
              DO UPDATE SET active = 1, sort_order = excluded.sort_order
            `).bind(name, order++).run();
          }
        }

        if (Array.isArray(data.services)) {
          const cleanServices = [...new Set(data.services.map((x) => typeof x === "string" ? x.trim() : String(x.name || "").trim()).filter(Boolean))];
          await env.DB.prepare("UPDATE services SET active = 0").run();
          let order = 1;
          for (const name of cleanServices) {
            await env.DB.prepare(`
              INSERT INTO services (name, active, sort_order)
              VALUES (?, 1, ?)
              ON CONFLICT(name)
              DO UPDATE SET active = 1, sort_order = excluded.sort_order
            `).bind(name, order++).run();
          }
        }

        return json({
          ok: true,
          message: "Configuración guardada",
          settings: await getSettings(env),
          professionals: await getProfessionals(env, true),
          services: await getServices(env, true),
        });
      }

      if (path === "/api/availability" && request.method === "GET") {
        const date = pick(url.searchParams.get("date"));
        const professional = pick(url.searchParams.get("professional"));
        if (!date || !professional) {
          return json({ ok: false, error: "Falta fecha o profesional" }, 400);
        }

        const settings = await getSettings(env);
        const open = settings.open || "09:00";
        const close = settings.close || "18:00";
        const slot = parseInt(settings.slot || "60", 10);

        const occupied = await env.DB
          .prepare(`
            SELECT time
            FROM appointments
            WHERE date = ?
              AND professional = ?
              AND status <> 'Cancelada'
          `)
          .bind(date, professional)
          .all();

        const busy = new Set((occupied.results || []).map((row) => row.time));
        const [openHour, openMinute] = open.split(":").map(Number);
        const [closeHour, closeMinute] = close.split(":").map(Number);

        let current = openHour * 60 + openMinute;
        const end = closeHour * 60 + closeMinute;
        const slots = [];

        while (current < end) {
          const hour = String(Math.floor(current / 60)).padStart(2, "0");
          const minute = String(current % 60).padStart(2, "0");
          const time = `${hour}:${minute}`;
          slots.push({ time, available: !busy.has(time) });
          current += slot;
        }

        return json({ ok: true, date, professional, open, close, slot, slots });
      }

      if (path === "/api/appointments" && request.method === "POST") {
        const data = await getBody(request);
        const name = String(pick(data.name, data.clientName)).trim();
        const phone = String(pick(data.phone)).trim();
        const service = String(pick(data.service)).trim();
        const professional = String(pick(data.professional)).trim();
        const date = String(pick(data.date)).trim();
        const time = String(pick(data.time)).trim();
        const notes = String(pick(data.notes)).trim();

        if (!name || !phone || !service || !professional || !date || !time) {
          return json({ ok: false, error: "Faltan datos obligatorios" }, 400);
        }

        await env.DB.prepare(`
          INSERT INTO clients (name, phone, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(phone)
          DO UPDATE SET
            name = excluded.name,
            updated_at = CURRENT_TIMESTAMP
        `).bind(name, phone).run();

        const client = await env.DB
          .prepare("SELECT id FROM clients WHERE phone = ?")
          .bind(phone)
          .first();

        const payment = buildPaymentPayload(data, {});

        try {
          const result = await env.DB.prepare(`
            INSERT INTO appointments
              (client_id, service, professional, date, time, notes, status, total_amount, amount_paid, payment_method, payment_status, payment_note, payment_updated_at)
            VALUES
              (?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `).bind(
            client.id,
            service,
            professional,
            date,
            time,
            notes,
            payment.totalAmount,
            payment.amountPaid,
            payment.paymentMethod,
            payment.paymentStatus,
            payment.paymentNote
          ).run();

          return json({
            ok: true,
            appointmentId: result.meta?.last_row_id,
            status: "Pendiente",
            payment: {
              total_amount: payment.totalAmount,
              amount_paid: payment.amountPaid,
              payment_method: payment.paymentMethod,
              payment_status: payment.paymentStatus,
              balance: payment.balance,
            },
          }, 201);
        } catch (error) {
          const message = String(error?.message || error).toLowerCase();
          if (message.includes("unique") || message.includes("constraint")) {
            return json({ ok: false, error: "Ese horario ya está ocupado" }, 409);
          }
          throw error;
        }
      }

      if (path === "/api/admin/appointments" && request.method === "GET") {
        if (!isAdmin(request, env)) {
          return json({ ok: false, error: "No autorizado" }, 401);
        }
        const filters = parseQueryFilters(url);
        const appointments = await fetchAppointments(env, filters);
        return json({ ok: true, appointments, summary: summarizePayments(appointments) });
      }

      if (path === "/api/admin/cobros" && request.method === "GET") {
        if (!isAdmin(request, env)) {
          return json({ ok: false, error: "No autorizado" }, 401);
        }
        const filters = parseQueryFilters(url);
        const appointments = await fetchAppointments(env, filters);
        return json({
          ok: true,
          cobros: appointments,
          summary: summarizePayments(appointments),
        });
      }

      if (path === "/api/admin/cobros/summary" && request.method === "GET") {
        if (!isAdmin(request, env)) {
          return json({ ok: false, error: "No autorizado" }, 401);
        }
        const filters = parseQueryFilters(url);
        const appointments = await fetchAppointments(env, filters);
        return json({ ok: true, summary: summarizePayments(appointments) });
      }

      if ((path.startsWith("/api/admin/appointments/") || path.startsWith("/api/admin/cobros/")) && request.method === "PUT") {
        const data = await getBody(request);
        if (!isAdmin(request, env, data)) {
          return json({ ok: false, error: "No autorizado" }, 401);
        }

        const id = path.split("/").filter(Boolean).pop();
        const existing = await env.DB
          .prepare(`
            SELECT id, status, total_amount, amount_paid, payment_method, payment_status, payment_note
            FROM appointments
            WHERE id = ?
          `)
          .bind(id)
          .first();

        if (!existing) {
          return json({ ok: false, error: "Cita no encontrada" }, 404);
        }

        const merged = buildAppointmentUpdate(data, existing);
        const appointmentStatus = normalizeAppointmentStatus(pick(data.status, data.appointmentStatus, data.estado, existing.status));

        await env.DB.prepare(`
          UPDATE appointments
          SET
            status = ?,
            total_amount = ?,
            amount_paid = ?,
            payment_method = ?,
            payment_status = ?,
            payment_note = ?,
            payment_updated_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(
          appointmentStatus,
          merged.totalAmount,
          merged.amountPaid,
          merged.paymentMethod,
          merged.paymentStatus,
          merged.paymentNote,
          id
        ).run();

        return json({
          ok: true,
          id: Number(id),
          status: appointmentStatus,
          payment: {
            total_amount: merged.totalAmount,
            amount_paid: merged.amountPaid,
            payment_method: merged.paymentMethod,
            payment_status: merged.paymentStatus,
            balance: merged.balance,
            payment_note: merged.paymentNote,
          },
        });
      }

      if (path.startsWith("/api/admin/appointments/") && request.method === "DELETE") {
        const data = await getBody(request);
        if (!isAdmin(request, env, data)) {
          return json({ ok: false, error: "No autorizado" }, 401);
        }

        const id = path.split("/").filter(Boolean).pop();
        await env.DB.prepare("DELETE FROM appointments WHERE id = ?").bind(id).run();
        return json({ ok: true, deleted: Number(id) });
      }

      if (path === "/api/admin/clients" && request.method === "GET") {
        if (!isAdmin(request, env)) {
          return json({ ok: false, error: "No autorizado" }, 401);
        }

        const result = await env.DB.prepare(`
          SELECT
            c.id,
            c.name,
            c.phone,
            c.created_at,
            c.updated_at,
            COUNT(a.id) AS appointments,
            COALESCE(SUM(a.amount_paid), 0) AS total_paid,
            COALESCE(SUM(a.total_amount), 0) AS total_amount
          FROM clients c
          LEFT JOIN appointments a
            ON a.client_id = c.id
          GROUP BY c.id
          ORDER BY c.updated_at DESC
        `).all();

        return json({ ok: true, clients: result.results || [] });
      }

      const clientMatch = path.match(/^\/api\/admin\/clients\/(\d+)$/);
      if (clientMatch && request.method === "GET") {
        if (!isAdmin(request, env)) {
          return json({ ok: false, error: "No autorizado" }, 401);
        }

        const clientId = Number(clientMatch[1]);
        const client = await getClientById(env, clientId);
        if (!client) {
          return json({ ok: false, error: "Cliente no encontrado" }, 404);
        }

        const history = await env.DB.prepare(`
          SELECT
            id,
            service,
            professional,
            date,
            time,
            notes,
            status,
            total_amount,
            amount_paid,
            payment_method,
            payment_status,
            payment_note,
            payment_updated_at,
            created_at
          FROM appointments
          WHERE client_id = ?
          ORDER BY date DESC, time DESC
        `).bind(clientId).all();

        const followups = await env.DB.prepare(`
          SELECT
            id,
            service,
            service_date,
            due_date,
            notes,
            status,
            created_at
          FROM client_followups
          WHERE client_id = ?
          ORDER BY
            CASE status
              WHEN 'Pendiente' THEN 0
              ELSE 1
            END,
            due_date ASC
        `).bind(clientId).all();

        return json({
          ok: true,
          client,
          history: history.results || [],
          followups: followups.results || [],
          paymentSummary: summarizePayments(history.results || []),
        });
      }

      const followupCreateMatch = path.match(/^\/api\/admin\/clients\/(\d+)\/followups$/);
      if (followupCreateMatch && request.method === "POST") {
        if (!isAdmin(request, env)) {
          return json({ ok: false, error: "No autorizado" }, 401);
        }

        const clientId = Number(followupCreateMatch[1]);
        const body = await getBody(request);
        const service = String(pick(body.service)).trim();
        const serviceDate = String(pick(body.service_date, body.serviceDate)).trim();
        const dueDate = String(pick(body.due_date, body.dueDate)).trim();
        const notes = String(pick(body.notes)).trim();

        if (!service || !serviceDate || !dueDate) {
          return json({ ok: false, error: "Servicio y fechas son requeridos" }, 400);
        }

        const client = await env.DB
          .prepare("SELECT id FROM clients WHERE id = ?")
          .bind(clientId)
          .first();

        if (!client) {
          return json({ ok: false, error: "Cliente no encontrado" }, 404);
        }

        const result = await env.DB.prepare(`
          INSERT INTO client_followups
            (client_id, service, service_date, due_date, notes, status)
          VALUES (?, ?, ?, ?, ?, 'Pendiente')
        `).bind(clientId, service, serviceDate, dueDate, notes).run();

        return json({
          ok: true,
          id: result.meta?.last_row_id || null,
          message: "Seguimiento guardado",
        }, 201);
      }

      const followupUpdateMatch = path.match(/^\/api\/admin\/followups\/(\d+)$/);
      if (followupUpdateMatch && request.method === "PUT") {
        if (!isAdmin(request, env)) {
          return json({ ok: false, error: "No autorizado" }, 401);
        }

        const body = await getBody(request);
        const status = String(pick(body.status, "Pendiente")).trim();
        const allowed = ["Pendiente", "Realizado", "Cancelado"];
        if (!allowed.includes(status)) {
          return json({ ok: false, error: "Estado inválido" }, 400);
        }

        const id = Number(followupUpdateMatch[1]);
        await env.DB.prepare(`
          UPDATE client_followups
          SET status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(status, id).run();

        return json({ ok: true, id, status });
      }

      if (path === "/api/admin/config" && request.method === "GET") {
        if (!isAdmin(request, env)) {
          return json({ ok: false, error: "No autorizado" }, 401);
        }

        return json({
          ok: true,
          settings: await getSettings(env),
          professionals: await getProfessionals(env, false),
          services: await getServices(env, false),
        });
      }

      return json({
        ok: false,
        error: "Ruta no encontrada",
        path,
      }, 404);
    } catch (error) {
      console.error(error);
      return json({
        ok: false,
        error: error?.message || "Error interno del servidor",
      }, 500);
    }
  },
};
