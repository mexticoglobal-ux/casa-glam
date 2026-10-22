CASA GLAM V2 — AGENDA ONLINE

1. Cloudflare D1: crear casa-glam-db.
2. D1 > Console: ejecutar TODO el contenido de schema.sql una sola vez.
3. Pages > casa-glam > Settings > Bindings > Add > D1 database:
   Variable name: DB
   Database: casa-glam-db
4. Settings > Variables and secrets > Add:
   Type: Secret
   Name: ADMIN_PIN
   Value: el PIN privado que Pamela usará para entrar a Agenda.
5. Crear un nuevo deployment con este ZIP. El binding entra en efecto en el siguiente deployment.
6. Probar una reserva desde un teléfono y abrir Agenda en otro dispositivo.

La V2 guarda citas/clientes/configuración en D1, bloquea horarios ocupados por profesional y permite estados Pendiente/Confirmada/Atendida/Cancelada. WhatsApp es complemento; la cita existe aunque el cliente cierre WhatsApp.
