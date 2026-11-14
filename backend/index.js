const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2kb' }));

// Conexión a la base de datos usando el nombre DNS del contenedor 'db'
const db = mysql.createPool({
  host: process.env.DB_HOST || 'db',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'redes123',
  database: process.env.DB_NAME || 'laboratorio',
  charset: 'utf8mb4'
});

// init.sql solo corre con el volumen vacío: si la base ya existía de antes, la tabla
// de ecos se crea aquí.
db.query(`CREATE TABLE IF NOT EXISTS ecos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  texto VARCHAR(140) NOT NULL,
  x FLOAT NOT NULL,
  y FLOAT NOT NULL,
  z FLOAT NOT NULL,
  zona VARCHAR(20) NOT NULL,
  likes INT NOT NULL DEFAULT 0,
  creado TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_zona (zona)
)`, (err) => {
  if (err) return console.error('No se pudo crear la tabla ecos:', err.message);
  sembrarEcos();
});

// Ecos iniciales repartidos por el mundo (prado e interiores de las casas). Se agregan al
// arrancar solo los que falten (por su texto), así que nunca se duplican y una base que ya
// existía también los recibe. Los interiores están lejos del prado: x de 400 en adelante
// y el piso a y = -50 (ver interiorMaps.ts).
const ECOS_INICIALES = [
  // [texto, x, y, z, zona, likes]
  ['¿Alguien más escucha el zumbido?', 9, 1.5, -2, 'prado', 4],
  ['La puerta amarilla no estaba aquí ayer.', 17, 1.6, -14, 'prado', 2],
  ['No mires al agujero mucho tiempo.', 30, 1.4, 12, 'prado', 6],
  ['Despertaste aquí también, ¿verdad?', 5, 1.6, 8, 'prado', 9],
  ['Alguien dejó la tele prendida. No hay enchufe.', -11.5, 1.5, 12, 'prado', 3],
  ['Los columpios se mueven solos. No hay viento.', 33.5, 1.5, 20.5, 'prado', 5],
  ['La máquina solo acepta monedas que no existen.', -3.5, 1.6, -3, 'prado', 2],
  ['Contesté el teléfono. Era mi propia voz.', 42, 1.5, 4, 'prado', 7],
  ['El agua de la piscina no moja.', -19, 1.3, 31.5, 'prado', 1],
  ['SALIDA. Llevo horas caminando hacia ella.', -26, 1.6, 10, 'prado', 4],
  ['Salí por esta puerta. Creo que entré por otra.', -18.5, 1.6, -19.5, 'prado', 3],
  ['Subí hasta arriba. No pasó nada. Eso fue lo peor.', -53.5, 4.6, -18.5, 'prado', 2],
  ['Desde aquí se ve todo. No hay nadie más.', -3.5, 14.6, -46.5, 'prado', 1],
  ['La casa está al revés. O yo.', 28, 1.5, -26.5, 'prado', 3],
  ['Algo cayó de la casa flotante. No quise mirar.', 55, 1.5, 54, 'prado', 0],
  ['La cerca no protege nada. O protege algo que no vemos.', 50, 1.4, -24, 'prado', 2],
  ['El sol no se ha movido en todo el día.', 12, 1.7, 30, 'prado', 5],
  ['No cierres la puerta.', 812.5, -48.5, -13.5, 'cloudhall', 3],
  ['El pasillo sigue. Siempre sigue.', 806.5, -48.5, -25.5, 'cloudhall', 2],
  ['Huele a cloro y a domingo.', 625.5, -48.5, -22.5, 'poolrooms', 4],
  ['El agua está tibia. Nadie la calienta.', 619.5, -48.5, -28.5, 'poolrooms', 1],
  ['El zumbido de las luces no para.', 419.5, -48.5, -29.5, 'backrooms', 6],
  ['Conté 400 habitaciones. Todas iguales.', 431.5, -48.5, -23.5, 'backrooms', 2],
];

// Una sola consulta para ver cuáles ya están y un solo INSERT con los que faltan
// (varios INSERT en paralelo se bloqueaban entre sí).
function sembrarEcos() {
  db.query('SELECT texto FROM ecos', (err, filas) => {
    if (err) return console.error('No se pudieron leer los ecos:', err.message);
    const existentes = new Set(filas.map((f) => f.texto));
    const faltan = ECOS_INICIALES.filter(([texto]) => !existentes.has(texto));
    if (faltan.length === 0) return;
    db.query('INSERT INTO ecos (texto, x, y, z, zona, likes) VALUES ?', [faltan], (err2) => {
      if (err2) console.error('No se pudieron sembrar los ecos:', err2.message);
      else console.log(`Ecos iniciales agregados: ${faltan.length}`);
    });
  });
}

const ZONAS = ['prado', 'backrooms', 'poolrooms', 'cloudhall'];
const MAX_TEXTO = 140;
const MAX_ECOS = 300;

// Límite sencillo: unas pocas notas por minuto por IP (en memoria).
const LIMITE_POR_MINUTO = 5;
const envios = new Map();
function puedePublicar(ip) {
  const ahora = Date.now();
  const recientes = (envios.get(ip) || []).filter((t) => ahora - t < 60000);
  if (recientes.length >= LIMITE_POR_MINUTO) return false;
  recientes.push(ahora);
  envios.set(ip, recientes);
  return true;
}

app.get('/api/estado', (req, res) => {
  db.query('SELECT contenido FROM mensaje_test LIMIT 1', (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ mensaje: results[0].contenido });
  });
});

// Lista los ecos (opcionalmente de una sola zona), los más recientes primero.
app.get('/api/ecos', (req, res) => {
  const { zona } = req.query;
  if (zona && !ZONAS.includes(zona)) return res.status(400).json({ error: 'Zona no válida' });
  const sql = zona
    ? 'SELECT id, texto, x, y, z, zona, likes, creado FROM ecos WHERE zona = ? ORDER BY creado DESC LIMIT ?'
    : 'SELECT id, texto, x, y, z, zona, likes, creado FROM ecos ORDER BY creado DESC LIMIT ?';
  const params = zona ? [zona, MAX_ECOS] : [MAX_ECOS];
  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// Deja un eco nuevo en la posición indicada.
app.post('/api/ecos', (req, res) => {
  const { texto, x, y, z, zona } = req.body || {};
  const limpio = typeof texto === 'string' ? texto.trim() : '';
  if (!limpio || limpio.length > MAX_TEXTO) {
    return res.status(400).json({ error: `El texto debe tener entre 1 y ${MAX_TEXTO} caracteres` });
  }
  if (![x, y, z].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return res.status(400).json({ error: 'Posición no válida' });
  }
  if (!ZONAS.includes(zona)) return res.status(400).json({ error: 'Zona no válida' });
  if (!puedePublicar(req.ip)) return res.status(429).json({ error: 'Demasiados ecos, espera un momento' });

  db.query(
    'INSERT INTO ecos (texto, x, y, z, zona) VALUES (?, ?, ?, ?, ?)',
    [limpio, x, y, z, zona],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      db.query('SELECT id, texto, x, y, z, zona, likes, creado FROM ecos WHERE id = ?', [result.insertId], (err2, rows) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.status(201).json(rows[0]);
      });
    }
  );
});

// "Yo también estuve aquí": suma uno a los likes del eco.
app.post('/api/ecos/:id/like', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id no válido' });
  db.query('UPDATE ecos SET likes = likes + 1 WHERE id = ?', [id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Eco no encontrado' });
    db.query('SELECT likes FROM ecos WHERE id = ?', [id], (err2, rows) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ id, likes: rows[0].likes });
    });
  });
});

app.listen(3000, () => console.log('Backend corriendo en el puerto 3000'));
