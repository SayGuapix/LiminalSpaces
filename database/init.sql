-- Se ejecuta solo la primera vez que arranca el contenedor (volumen db_data vacío).
CREATE DATABASE IF NOT EXISTS laboratorio;
USE laboratorio;

CREATE TABLE mensaje_test (
    id INT AUTO_INCREMENT PRIMARY KEY,
    contenido VARCHAR(255) NOT NULL
);

INSERT INTO mensaje_test (contenido)
VALUES ('¡Felicidades! La conexión completa desde el Frontend hasta la Base de Datos funciona correctamente.');

-- Ecos: notas que dejan los visitantes en el mundo 3D, en la posición donde las escribieron.
CREATE TABLE ecos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    texto VARCHAR(140) NOT NULL,
    x FLOAT NOT NULL,
    y FLOAT NOT NULL,
    z FLOAT NOT NULL,
    zona VARCHAR(20) NOT NULL,
    likes INT NOT NULL DEFAULT 0,
    creado TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_zona (zona)
);

-- Los ecos iniciales los agrega el backend al arrancar (ECOS_INICIALES en backend/index.js),
-- solo los que falten: así también llegan a una base que ya existía.
