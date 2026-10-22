PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS professionals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS appointments (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, service TEXT NOT NULL, professional TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, notes TEXT DEFAULT '', price REAL NOT NULL DEFAULT 0, deposit REAL NOT NULL DEFAULT 0, payment_method TEXT NOT NULL DEFAULT 'Efectivo', payment_status TEXT NOT NULL DEFAULT 'Pendiente', status TEXT NOT NULL DEFAULT 'Pendiente' CHECK(status IN ('Pendiente','Confirmada','Reprogramada','Atendida','Cancelada')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(client_id) REFERENCES clients(id));
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_slot ON appointments(professional,date,time) WHERE status <> 'Cancelada';
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date,time);
INSERT OR IGNORE INTO settings(key,value) VALUES ('open','09:00'),('close','18:00'),('slot','60');
INSERT OR IGNORE INTO professionals(name,sort_order) VALUES ('Pamela González',1);
INSERT OR IGNORE INTO services(name,sort_order) VALUES
('Corte de cabello mujer',1),('Lavado y secado',2),('Lavado y peinado',3),('Brushing',4),('Planchado',5),('Ondas',6),('Peinado para evento',7),('Tinte de cabello',8),('Retoque de raíz',9),('Cobertura de canas',10),('Balayage',11),('Mechas / Highlights',12),('Babylights',13),('Matización',14),('Keratina',15),('Hidratación profunda',16),('Tratamiento de reparación capilar',17),('Maquillaje',18),('Barbería para hombres',19);

CREATE TABLE IF NOT EXISTS client_followups (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, service TEXT NOT NULL, service_date TEXT NOT NULL, due_date TEXT NOT NULL, notes TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'Pendiente' CHECK(status IN ('Pendiente','Realizado','Cancelado')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(client_id) REFERENCES clients(id));
CREATE INDEX IF NOT EXISTS idx_followups_due ON client_followups(status,due_date);
