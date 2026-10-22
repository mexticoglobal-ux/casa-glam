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



async function getBody(request) {

  try {

    return await request.json();

  } catch {

    return {};

  }

}



function isAdmin(request, env, data = {}) {

  const pin =

    request.headers.get("X-Admin-Pin") ||

    data.pin ||

    data.adminPin ||

    "";



  return (

    !!env.ADMIN_PIN &&

    String(pin) === String(env.ADMIN_PIN)

  );

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



async function ensurePaymentColumns(env) {
  if (env._paymentColumnsReady) return;
  if (!env._paymentColumnsPromise) {
    env._paymentColumnsPromise = (async () => {
      const info = await env.DB.prepare("PRAGMA table_info(appointments)").all();
      const cols = new Set((info.results || []).map((c) => c.name));
      if (!cols.has("price")) {
        await env.DB.prepare("ALTER TABLE appointments ADD COLUMN price REAL NOT NULL DEFAULT 0").run();
      }
      if (!cols.has("deposit")) {
        await env.DB.prepare("ALTER TABLE appointments ADD COLUMN deposit REAL NOT NULL DEFAULT 0").run();
      }
      if (!cols.has("payment_method")) {
        await env.DB.prepare("ALTER TABLE appointments ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'Efectivo'").run();
      }
      if (!cols.has("payment_status")) {
        await env.DB.prepare("ALTER TABLE appointments ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'Pendiente'").run();
      }
      env._paymentColumnsReady = true;
    })().catch((err) => {
      env._paymentColumnsPromise = null;
      throw err;
    });
  }
  await env._paymentColumnsPromise;
}



export default {

  async fetch(request, env) {

    if (request.method === "OPTIONS") {

      return new Response(null, { headers: cors });

    }



    const url = new URL(request.url);

    const path = url.pathname.replace(/\/+$/, "") || "/";

    await ensurePaymentColumns(env);


    try {

      // ==========================================*

      // API STATUS*

      // ==========================================*



      if (path === "/" || path === "/api") {

        return json({

          ok: true,

          service: "Casa Glam API",

          database: !!env.DB,

          adminPinConfigured: !!env.ADMIN_PIN,

        });

      }



      // ==========================================*

      // ADMIN LOGIN*

      // ==========================================*



      if (

        (path === "/api/admin" ||

          path === "/api/admin/login" ||

          path === "/admin/login") &&

        request.method === "POST"

      ) {

        const data = await getBody(request);



        if (!isAdmin(request, env, data)) {

          return json(

            {

              ok: false,

              error: "PIN incorrecto",

            },

            401

          );

        }



        return json({

          ok: true,

          authenticated: true,

        });

      }



      // ==========================================*

      // PUBLIC CONFIG*

      // ==========================================*



      if (

        path === "/api/config" &&

        request.method === "GET"

      ) {

        const settings = await getSettings(env);

        const professionals =

          await getProfessionals(env, true);

        const services =

          await getServices(env, true);



        return json({

          ok: true,

          settings,

          professionals,

          services,

        });

      }



      // ==========================================*

      // SAVE CONFIG - ADMIN*

      // ==========================================*



      if (

        (path === "/api/admin/config" ||

          path === "/api/config") &&

        request.method === "PUT"

      ) {

        const data = await getBody(request);



        if (!isAdmin(request, env, data)) {

          return json(

            {

              ok: false,

              error: "No autorizado",

            },

            401

          );

        }



        const open =

          String(

            data.open ||

              data.settings?.open ||

              "09:00"

          ).trim();



        const close =

          String(

            data.close ||

              data.settings?.close ||

              "18:00"

          ).trim();



        const slot =

          String(

            data.slot ||

              data.settings?.slot ||

              "60"

          ).trim();



        const allowedSlots = ["30", "60", "90"];



        if (!allowedSlots.includes(slot)) {

          return json(

            {

              ok: false,

              error:

                "La duración debe ser 30, 60 o 90 minutos",

            },

            400

          );

        }



        await env.DB

          .prepare(`

            INSERT INTO settings(key,value)

            VALUES ('open',?)

            ON CONFLICT(key)

            DO UPDATE SET value = excluded.value

          `)

          .bind(open)

          .run();



        await env.DB

          .prepare(`

            INSERT INTO settings(key,value)

            VALUES ('close',?)

            ON CONFLICT(key)

            DO UPDATE SET value = excluded.value

          `)

          .bind(close)

          .run();



        await env.DB

          .prepare(`

            INSERT INTO settings(key,value)

            VALUES ('slot',?)

            ON CONFLICT(key)

            DO UPDATE SET value = excluded.value

          `)

          .bind(slot)

          .run();



        // PROFESIONALES*

        if (Array.isArray(data.professionals)) {

          const cleanProfessionals = [

            ...new Set(

              data.professionals

                .map((x) =>

                  typeof x === "string"

                    ? x.trim()

                    : String(x.name || "").trim()

                )

                .filter(Boolean)

            ),

          ];



          await env.DB

            .prepare(

              "UPDATE professionals SET active = 0"

            )

            .run();



          let order = 1;



          for (const name of cleanProfessionals) {

            await env.DB

              .prepare(`

                INSERT INTO professionals

                  (name, active, sort_order)

                VALUES (?, 1, ?)

                ON CONFLICT(name)

                DO UPDATE SET

                  active = 1,

                  sort_order = excluded.sort_order

              `)

              .bind(name, order++)

              .run();

          }

        }



        // SERVICIOS*

        if (Array.isArray(data.services)) {

          const cleanServices = [

            ...new Set(

              data.services

                .map((x) =>

                  typeof x === "string"

                    ? x.trim()

                    : String(x.name || "").trim()

                )

                .filter(Boolean)

            ),

          ];



          await env.DB

            .prepare(

              "UPDATE services SET active = 0"

            )

            .run();



          let order = 1;



          for (const name of cleanServices) {

            await env.DB

              .prepare(`

                INSERT INTO services

                  (name, active, sort_order)

                VALUES (?, 1, ?)

                ON CONFLICT(name)

                DO UPDATE SET

                  active = 1,

                  sort_order = excluded.sort_order

              `)

              .bind(name, order++)

              .run();

          }

        }



        return json({

          ok: true,

          message: "Configuración guardada",

          settings: await getSettings(env),

          professionals:

            await getProfessionals(env, true),

          services:

            await getServices(env, true),

        });

      }



      // ==========================================*

      // AVAILABILITY*

      // ==========================================*



      if (

        path === "/api/availability" &&

        request.method === "GET"

      ) {

        const date =

          url.searchParams.get("date");

        const professional =

          url.searchParams.get("professional");



        if (!date || !professional) {

          return json(

            {

              ok: false,

              error:

                "Falta fecha o profesional",

            },

            400

          );

        }



        const settings = await getSettings(env);



        const open = settings.open || "09:00";

        const close = settings.close || "18:00";

        const slot = parseInt(

          settings.slot || "60",

          10

        );



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



        const busy = new Set(

          (occupied.results || []).map(

            (row) => row.time

          )

        );



        const [openHour, openMinute] =

          open.split(":").map(Number);



        const [closeHour, closeMinute] =

          close.split(":").map(Number);



        let current =

          openHour * 60 + openMinute;



        const end =

          closeHour * 60 + closeMinute;



        const slots = [];



        while (current < end) {

          const hour = String(

            Math.floor(current / 60)

          ).padStart(2, "0");



          const minute = String(

            current % 60

          ).padStart(2, "0");



          const time = `${hour}:${minute}`;



          slots.push({

            time,

            available: !busy.has(time),

          });



          current += slot;

        }



        return json({

          ok: true,

          date,

          professional,

          open,

          close,

          slot,

          slots,

        });

      }



      // ==========================================*

      // CREATE APPOINTMENT*

      // ==========================================*



      if (

        path === "/api/appointments" &&

        request.method === "POST"

      ) {

        const data = await getBody(request);



        const name = String(

          data.name ||

            data.clientName ||

            ""

        ).trim();



        const phone = String(

          data.phone || ""

        ).trim();



        const service = String(

          data.service || ""

        ).trim();



        const professional = String(

          data.professional || ""

        ).trim();



        const date = String(

          data.date || ""

        ).trim();



        const time = String(

          data.time || ""

        ).trim();



        const notes = String(

          data.notes || ""

        ).trim();



        if (

          !name ||

          !phone ||

          !service ||

          !professional ||

          !date ||

          !time

        ) {

          return json(

            {

              ok: false,

              error:

                "Faltan datos obligatorios",

            },

            400

          );

        }



        // Validación previa para mostrar una alerta clara si el horario ya está ocupado.
        // El índice UNIQUE de D1 sigue protegiendo contra reservas simultáneas.
        const occupiedSlot = await env.DB
          .prepare(`
            SELECT id
            FROM appointments
            WHERE professional = ?
              AND date = ?
              AND time = ?
              AND status <> 'Cancelada'
            LIMIT 1
          `)
          .bind(professional, date, time)
          .first();

        if (occupiedSlot) {
          return json(
            {
              ok: false,
              code: "SLOT_OCCUPIED",
              error: "Esta hora ya fue reservada. Por favor selecciona otro horario disponible.",
              date,
              time,
              professional,
            },
            409
          );
        }

        await env.DB

          .prepare(`

            INSERT INTO clients

              (name, phone, updated_at)

            VALUES

              (?, ?, CURRENT_TIMESTAMP)

            ON CONFLICT(phone)

            DO UPDATE SET

              name = excluded.name,

              updated_at = CURRENT_TIMESTAMP

          `)

          .bind(name, phone)

          .run();



        const client = await env.DB

          .prepare(

            "SELECT id FROM clients WHERE phone = ?"

          )

          .bind(phone)

          .first();



        try {

          const result = await env.DB

            .prepare(`

              INSERT INTO appointments

                (

                  client_id,

                  service,

                  professional,

                  date,

                  time,

                  notes,

                  status

                )

              VALUES

                (?, ?, ?, ?, ?, ?, 'Pendiente')

            `)

            .bind(

              client.id,

              service,

              professional,

              date,

              time,

              notes

            )

            .run();



          return json(

            {

              ok: true,

              appointmentId:

                result.meta?.last_row_id,

              status: "Pendiente",

            },

            201

          );

        } catch (error) {

          const message = String(

            error.message || error

          ).toLowerCase();



          if (

            message.includes("unique") ||

            message.includes("constraint")

          ) {

            return json(

              {

                ok: false,

                code: "SLOT_OCCUPIED",

                error:

                  "Esta hora acaba de ser reservada por otra persona. Por favor selecciona otro horario disponible.",

                date,

                time,

                professional,

              },

              409

            );

          }



          throw error;

        }

      }



      // ==========================================*

      // ADMIN APPOINTMENTS*

      // ==========================================*



      if (

        path === "/api/admin/appointments" &&

        request.method === "GET"

      ) {

        if (!isAdmin(request, env)) {

          return json(

            {

              ok: false,

              error: "No autorizado",

            },

            401

          );

        }



        const result = await env.DB

          .prepare(`

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

              a.price,

              a.deposit,

              a.payment_method,
              a.payment_status,
              a.created_at,
              a.updated_at

            FROM appointments a

            JOIN clients c

              ON c.id = a.client_id

            ORDER BY

              a.date ASC,

              a.time ASC

          `)

          .all();



        return json({

          ok: true,

          appointments:

            result.results || [],

        });

      }



      // ==========================================*

      // UPDATE APPOINTMENT STATUS*

      // ==========================================*\n      if (\n        path.startsWith(\n          "/api/admin/payments/"\n        ) &&\n        request.method === "PUT"\n      ) {\n        const data = await getBody(request);\n        if (!isAdmin(request, env, data)) {\n          return json(\n            { ok: false, error: "No autorizado" },\n            401\n          );\n        }\n\n        const id = path\n          .split("/")\n          .filter(Boolean)\n          .pop();\n\n        const hasPrice = Object.prototype.hasOwnProperty.call(data, "price");\n        const hasDeposit = Object.prototype.hasOwnProperty.call(data, "deposit");\n        const hasPaymentMethod = Object.prototype.hasOwnProperty.call(data, "payment_method");\n        const hasPaymentStatus = Object.prototype.hasOwnProperty.call(data, "payment_status");\n\n        const rawPrice = hasPrice ? String(data.price ?? "").trim() : "";\n        const rawDeposit = hasDeposit ? String(data.deposit ?? "").trim() : "";\n        const normalizedPrice = rawPrice !== "" ? Math.max(0, Number(rawPrice)) : null;\n        const normalizedDeposit = rawDeposit !== "" ? Math.max(0, Number(rawDeposit)) : null;\n        const price = Number.isFinite(normalizedPrice) ? normalizedPrice : null;\n        const deposit = Number.isFinite(normalizedDeposit) ? normalizedDeposit : null;\n        const paymentMethod = hasPaymentMethod ? String(data.payment_method || "").trim() : null;\n        const paymentStatus = hasPaymentStatus ? String(data.payment_status || "").trim() : null;\n\n        const finalPrice = price !== null ? price : (deposit !== null ? deposit : null);\n        const finalDeposit = deposit !== null ? deposit : (price !== null ? price : null);\n        const allowedPaymentStatus = ["Pendiente", "Cobrado", "Pendiente SINPE"];\n\n        if (paymentStatus && !allowedPaymentStatus.includes(paymentStatus)) {\n          return json({ ok: false, error: "Estado de cobro inválido" }, 400);\n        }\n\n        const existing = await env.DB\n          .prepare(`\n            SELECT id\n            FROM appointments\n            WHERE id = ?\n          `)\n          .bind(id)\n          .first();\n\n        if (!existing) {\n          return json(\n            { ok: false, error: "Cita no encontrada" },\n            404\n          );\n        }\n\n        await env.DB\n          .prepare(`\n            UPDATE appointments\n            SET\n              price = COALESCE(?, price),\n              deposit = COALESCE(?, deposit),\n              payment_method = COALESCE(?, payment_method),\n              payment_status = COALESCE(?, payment_status),\n              updated_at = CURRENT_TIMESTAMP\n            WHERE id = ?\n          `)\n          .bind(\n            finalPrice,\n            finalDeposit,\n            paymentMethod || null,\n            paymentStatus || null,\n            id\n          )\n          .run();\n\n        const result = await env.DB\n          .prepare(`\n            SELECT\n              a.id,\n              c.name,\n              c.phone,\n              a.service,\n              a.professional,\n              a.date,\n              a.time,\n              a.notes,\n              a.status,\n              a.price,\n              a.deposit,\n              a.payment_method,\n              a.payment_status,\n              a.created_at,\n              a.updated_at\n            FROM appointments a\n            JOIN clients c\n              ON c.id = a.client_id\n            WHERE a.id = ?\n          `)\n          .bind(id)\n          .first();\n\n        return json({\n          ok: true,\n          appointment: result || null,\n        });\n      }\n\n



      if (

        path.startsWith(

          "/api/admin/appointments/"

        ) &&

        request.method === "PUT"

      ) {

        const data = await getBody(request);



        if (!isAdmin(request, env, data)) {

          return json(

            {

              ok: false,

              error: "No autorizado",

            },

            401

          );

        }



        const id = path

          .split("/")

          .filter(Boolean)

          .pop();



        const status = String(

          data.status || ""

        ).trim();

        const hasPrice = Object.prototype.hasOwnProperty.call(data, "price");
        const hasDeposit = Object.prototype.hasOwnProperty.call(data, "deposit");
        const hasPaymentMethod = Object.prototype.hasOwnProperty.call(data, "payment_method");
        const hasPaymentStatus = Object.prototype.hasOwnProperty.call(data, "payment_status");

        const rawPrice = hasPrice ? String(data.price ?? "").trim() : "";
        const rawDeposit = hasDeposit ? String(data.deposit ?? "").trim() : "";
        const normalizedPrice = rawPrice !== "" ? Math.max(0, Number(rawPrice)) : null;
        const normalizedDeposit = rawDeposit !== "" ? Math.max(0, Number(rawDeposit)) : null;
        const price = Number.isFinite(normalizedPrice) ? normalizedPrice : null;
        const deposit = Number.isFinite(normalizedDeposit) ? normalizedDeposit : null;
        const paymentMethod = hasPaymentMethod ? String(data.payment_method || "").trim() : null;
        const paymentStatus = hasPaymentStatus ? String(data.payment_status || "").trim() : null;

        const finalPrice = price !== null ? price : (deposit !== null ? deposit : null);
        const finalDeposit = deposit !== null ? deposit : (price !== null ? price : null);

        const allowed = [
          "Pendiente",
          "Confirmada",
          "Reprogramada",
          "Atendida",
          "Cancelada",
        ];
        const allowedPaymentStatus = ["Pendiente", "Cobrado", "Pendiente SINPE"];



        if (!allowed.includes(status)) {

          return json(

            {

              ok: false,

              error: "Estado inválido",

            },

            400

          );

        }



        const existing = await env.DB

          .prepare(`

            SELECT id

            FROM appointments

            WHERE id = ?

          `)

          .bind(id)

          .first();



        if (!existing) {

          return json(

            {

              ok: false,

              error: "Cita no encontrada",

            },

            404

          );

        }

        if (paymentStatus && !allowedPaymentStatus.includes(paymentStatus)) {
          return json({ ok: false, error: "Estado de cobro inválido" }, 400);
        }



        try {
          await env.DB
            .prepare(`
              UPDATE appointments
              SET
                status = ?,
                price = COALESCE(?, price),
                deposit = COALESCE(?, deposit),
                payment_method = COALESCE(?, payment_method),
                payment_status = COALESCE(?, payment_status),
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `)
            .bind(
              status,
              finalPrice,
              finalDeposit,
              paymentMethod || null,
              paymentStatus || null,
              id
            )
            .run();
        } catch (error) {
          const message = String(error?.message || error).toLowerCase();
          if (message.includes("unique") || message.includes("constraint")) {
            return json(
              {
                ok: false,
                code: "SLOT_OCCUPIED",
                error: "No se puede reactivar esta cita porque ese horario ya está ocupado.",
              },
              409
            );
          }
          throw error;
        }

        return json({

          ok: true,

          id: Number(id),

          status,

        });

      }



      // ==========================================*

      // DELETE APPOINTMENT - ADMIN*

      // ==========================================*



      if (

        path.startsWith(

          "/api/admin/appointments/"

        ) &&

        request.method === "DELETE"

      ) {

        const data = await getBody(request);



        if (!isAdmin(request, env, data)) {

          return json(

            {

              ok: false,

              error: "No autorizado",

            },

            401

          );

        }



        const id = path

          .split("/")

          .filter(Boolean)

          .pop();



        await env.DB

          .prepare(`

            DELETE FROM appointments

            WHERE id = ?

          `)

          .bind(id)

          .run();



        return json({

          ok: true,

          deleted: Number(id),

        });

      }



      // ==========================================*

      // CLIENTS*

      // ==========================================*



      if (

        path === "/api/admin/clients" &&

        request.method === "GET"

      ) {

        if (!isAdmin(request, env)) {

          return json(

            {

              ok: false,

              error: "No autorizado",

            },

            401

          );

        }



        const result = await env.DB

          .prepare(`

            SELECT

              c.id,

              c.name,

              c.phone,

              c.created_at,

              c.updated_at,

              COUNT(a.id) AS appointments,
              MAX(CASE WHEN a.status = 'Atendida' THEN a.date END) AS last_visit,
              MIN(CASE WHEN a.status <> 'Cancelada' AND a.date >= date('now') THEN a.date END) AS next_appointment

            FROM clients c

            LEFT JOIN appointments a

              ON a.client_id = c.id

            GROUP BY c.id

            ORDER BY

              c.updated_at DESC

          `)

          .all();



        return json({

          ok: true,

          clients: result.results || [],

        });

      }



      // ==========================================
      // CLIENT CRM + FOLLOWUPS (V2.4)
      // ==========================================

      const clientMatch = path.match(/^\/api\/admin\/clients\/(\d+)$/);
      if (clientMatch && request.method === "GET") {
        if (!isAdmin(request, env)) return json({ ok:false, error:"No autorizado" },401);
        const clientId = Number(clientMatch[1]);
        const client = await env.DB.prepare(`SELECT id,name,phone,created_at,updated_at FROM clients WHERE id=?`).bind(clientId).first();
        if (!client) return json({ok:false,error:"Cliente no encontrado"},404);
        const history = await env.DB.prepare(`SELECT id,service,professional,date,time,notes,status,price,deposit,payment_method,payment_status,created_at FROM appointments WHERE client_id=? ORDER BY date DESC,time DESC`).bind(clientId).all();
        const followups = await env.DB.prepare(`SELECT id,service,service_date,due_date,notes,status,created_at FROM client_followups WHERE client_id=? ORDER BY CASE status WHEN 'Pendiente' THEN 0 ELSE 1 END,due_date ASC`).bind(clientId).all();
        return json({ok:true,client,history:history.results||[],followups:followups.results||[]});
      }

      const followupCreateMatch = path.match(/^\/api\/admin\/clients\/(\d+)\/followups$/);
      if (followupCreateMatch && request.method === "POST") {
        if (!isAdmin(request, env)) return json({ ok:false, error:"No autorizado" },401);
        const clientId=Number(followupCreateMatch[1]); const body=await getBody(request);
        const service=String(body.service||'').trim(), serviceDate=String(body.service_date||'').trim(), dueDate=String(body.due_date||'').trim(), notes=String(body.notes||'').trim();
        if(!service||!serviceDate||!dueDate) return json({ok:false,error:"Servicio y fechas son requeridos"},400);
        const result=await env.DB.prepare(`INSERT INTO client_followups(client_id,service,service_date,due_date,notes,status) VALUES(?,?,?,?,?,'Pendiente')`).bind(clientId,service,serviceDate,dueDate,notes).run();
        return json({ok:true,id:result.meta?.last_row_id||null},201);
      }

      const followupUpdateMatch = path.match(/^\/api\/admin\/followups\/(\d+)$/);
      if (followupUpdateMatch && request.method === "PUT") {
        if (!isAdmin(request, env)) return json({ ok:false, error:"No autorizado" },401);
        const body=await getBody(request); const status=String(body.status||'').trim();
        if(!['Pendiente','Realizado','Cancelado'].includes(status)) return json({ok:false,error:"Estado inválido"},400);
        await env.DB.prepare(`UPDATE client_followups SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(status,Number(followupUpdateMatch[1])).run();
        return json({ok:true});
      }

      // ==========================================
      // DASHBOARD + RECORDATORIOS (V3.0)
      // ==========================================

      if (path === "/api/admin/dashboard" && request.method === "GET") {
        if (!isAdmin(request, env)) return json({ ok:false, error:"No autorizado" },401);

        const summary = await env.DB.prepare(`
          SELECT
            SUM(CASE WHEN date = date('now','-6 hours') AND status <> 'Cancelada' THEN 1 ELSE 0 END) AS today,
            SUM(CASE WHEN date = date('now','-6 hours','+1 day') AND status <> 'Cancelada' THEN 1 ELSE 0 END) AS tomorrow,
            SUM(CASE WHEN status = 'Pendiente' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'Confirmada' THEN 1 ELSE 0 END) AS confirmed,
            SUM(CASE WHEN status = 'Reprogramada' THEN 1 ELSE 0 END) AS reprogrammed,
            SUM(CASE WHEN status = 'Atendida' AND strftime('%Y-%m',date)=strftime('%Y-%m','now','-6 hours') THEN 1 ELSE 0 END) AS attended_month,
            SUM(CASE WHEN COALESCE(price,0) > COALESCE(deposit,0) THEN COALESCE(price,0) - COALESCE(deposit,0) ELSE 0 END) AS balance,
            SUM(CASE WHEN lower(COALESCE(payment_status,'Pendiente')) = 'cobrado' THEN COALESCE(deposit,0) ELSE 0 END) AS revenue,
            SUM(CASE WHEN lower(COALESCE(payment_status,'Pendiente')) = 'cobrado' AND lower(COALESCE(payment_method,'Efectivo')) = 'sinpe' THEN COALESCE(deposit,0) ELSE 0 END) AS sinpe_revenue,
            SUM(CASE WHEN lower(COALESCE(payment_status,'Pendiente')) = 'cobrado' AND lower(COALESCE(payment_method,'Efectivo')) = 'efectivo' THEN COALESCE(deposit,0) ELSE 0 END) AS cash_revenue,
            SUM(CASE WHEN lower(COALESCE(payment_status,'Pendiente')) = 'pendiente sinpe' THEN COALESCE(deposit,0) ELSE 0 END) AS pending_sinpe
          FROM appointments
        `).first();

        const clientStats = await env.DB.prepare(`
          SELECT
            COUNT(*) AS clients,
            SUM(CASE WHEN appts >= 2 THEN 1 ELSE 0 END) AS recurrent
          FROM (
            SELECT c.id, COUNT(CASE WHEN a.status <> 'Cancelada' THEN 1 END) AS appts
            FROM clients c
            LEFT JOIN appointments a ON a.client_id = c.id
            GROUP BY c.id
          )
        `).first();

        const topServices = await env.DB.prepare(`
          SELECT service, COUNT(*) AS total
          FROM appointments
          WHERE status <> 'Cancelada'
            AND strftime('%Y-%m',date)=strftime('%Y-%m','now','-6 hours')
          GROUP BY service
          ORDER BY total DESC, service ASC
          LIMIT 5
        `).all();

        const daily = await env.DB.prepare(`
          WITH RECURSIVE days(n,d) AS (
            SELECT 0, date('now','-6 hours','-6 day')
            UNION ALL
            SELECT n+1, date(d,'+1 day') FROM days WHERE n < 6
          )
          SELECT d AS date,
                 COUNT(a.id) AS total
          FROM days
          LEFT JOIN appointments a
            ON a.date = d AND a.status <> 'Cancelada'
          GROUP BY d
          ORDER BY d
        `).all();

        const reminderCount = await env.DB.prepare(`
          SELECT
            (SELECT COUNT(*) FROM appointments
              WHERE status IN ('Pendiente','Confirmada','Reprogramada')
                AND datetime(date || ' ' || time) > datetime('now','-6 hours')
                AND datetime(date || ' ' || time) <= datetime('now','-6 hours','+24 hours'))
            +
            (SELECT COUNT(*) FROM client_followups
              WHERE status='Pendiente'
                AND due_date <= date('now','-6 hours','+7 day'))
            AS total
        `).first();

        return json({
          ok:true,
          summary:{
            today:Number(summary?.today||0),
            tomorrow:Number(summary?.tomorrow||0),
            pending:Number(summary?.pending||0),
            confirmed:Number(summary?.confirmed||0),
            attendedMonth:Number(summary?.attended_month||0),
            clients:Number(clientStats?.clients||0),
            recurrent:Number(clientStats?.recurrent||0),
            reminders:Number(reminderCount?.total||0),
            balance:Number(summary?.balance||0),
            revenue:Number(summary?.revenue||0),
            sinpeRevenue:Number(summary?.sinpe_revenue||0),
            cashRevenue:Number(summary?.cash_revenue||0),
            pendingSinpe:Number(summary?.pending_sinpe||0)
          },
          topServices:topServices.results||[],
          daily:daily.results||[]
        });
      }

      if (path === "/api/admin/reminders" && request.method === "GET") {
        if (!isAdmin(request, env)) return json({ ok:false, error:"No autorizado" },401);

        const appts = await env.DB.prepare(`
          SELECT a.id,a.service,a.professional,a.date,a.time,a.status,c.name,c.phone,
            CASE
              WHEN datetime(a.date || ' ' || a.time) <= datetime('now','-6 hours','+2 hours') THEN '2h'
              ELSE '24h'
            END AS reminder_type
          FROM appointments a
          JOIN clients c ON c.id=a.client_id
          WHERE a.status IN ('Pendiente','Confirmada','Reprogramada')
            AND datetime(a.date || ' ' || a.time) > datetime('now','-6 hours')
            AND datetime(a.date || ' ' || a.time) <= datetime('now','-6 hours','+24 hours')
          ORDER BY a.date,a.time
        `).all();

        const followups = await env.DB.prepare(`
          SELECT f.id,f.service,f.service_date,f.due_date,f.notes,f.status,c.name,c.phone
          FROM client_followups f
          JOIN clients c ON c.id=f.client_id
          WHERE f.status='Pendiente'
            AND f.due_date <= date('now','-6 hours','+7 day')
          ORDER BY f.due_date,c.name
        `).all();

        return json({ok:true,appointments:appts.results||[],followups:followups.results||[]});
      }

      // ==========================================*

      // ADMIN FULL CONFIG*

      // ==========================================*



      if (

        path === "/api/admin/config" &&

        request.method === "GET"

      ) {

        if (!isAdmin(request, env)) {

          return json(

            {

              ok: false,

              error: "No autorizado",

            },

            401

          );

        }



        return json({

          ok: true,

          settings:

            await getSettings(env),

          professionals:

            await getProfessionals(

              env,

              false

            ),

          services:

            await getServices(

              env,

              false

            ),

        });

      }



      return json(

        {

          ok: false,

          error: "Ruta no encontrada",

          path,

        },

        404

      );

    } catch (error) {

      console.error(error);



      return json(

        {

          ok: false,

          error:

            error?.message ||

            "Error interno del servidor",

        },

        500

      );

    }

  },

};