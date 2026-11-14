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
  if (err) console.error('No se pudo crear la tabla ecos:', err.message);
});

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
