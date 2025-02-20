require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const helmet = require('helmet');
const https = require('https');
const fs = require('fs');
const morgan = require('morgan');

const app = express();

// Устанавливаем безопасные HTTP-заголовки
app.use(helmet());

// Логирование запросов (в режиме разработки)
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Для парсинга JSON в теле запроса
app.use(express.json());

// Настройка подключения к базе данных PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Если требуется SSL (например, на Heroku), раскомментируйте следующую строку:
  // ssl: { rejectUnauthorized: false }
});

// Middleware для проверки административного API-ключа
const adminAuth = (req, res, next) => {
  const token = req.header('x-api-key');
  if (!token || token !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
};

/**
 * Эндпоинт для проверки кода.
 * GET /projects/sportext/check/:code
 */
app.get('/projects/sportext/check/:code', async (req, res) => {
  const { code } = req.params;
  if (!code) {
    return res.status(400).json({ error: 'Code parameter is required' });
  }
  try {
    const query = 'SELECT active, expiry_date FROM keys WHERE code = $1';
    const { rows } = await pool.query(query, [code]);
    if (rows.length === 0) {
      return res.json(false);
    }
    return res.json(rows[0]);
  } catch (error) {
    console.error('Ошибка при проверке кода:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Эндпоинт для добавления нового кода (админский).
 * POST /projects/sportext/add
 * Ожидает JSON с полями: code, active (необязательно), expiry_date
 */
app.post('/projects/sportext/add', adminAuth, async (req, res) => {
  const { code, active, expiry_date } = req.body;
  if (!code) {
    return res
      .status(400)
      .json({ error: 'Поле "code" обязательно для заполнения' });
  }
  if (!expiry_date || isNaN(Date.parse(expiry_date))) {
    return res
      .status(400)
      .json({ error: 'Поле "expiry_date" должно содержать корректную дату' });
  }
  try {
    const insertQuery = `
      INSERT INTO keys (code, active, expiry_date)
      VALUES ($1, $2, $3)
      RETURNING id
    `;
    const { rows } = await pool.query(insertQuery, [
      code,
      active !== undefined ? active : true,
      expiry_date,
    ]);
    return res
      .status(201)
      .json({ message: 'Код успешно добавлен', id: rows[0].id });
  } catch (error) {
    console.error('Ошибка при добавлении кода:', error);
    if (error.code === '23505') {
      // нарушение уникальности
      return res.status(409).json({ error: 'Код уже существует' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Эндпоинт для генерации 6-значного кода со сроком действия 1 неделя.
 * GET /projects/sportext/generate/:code
 */
app.get('/projects/sportext/generate/:code', async (req, res) => {
  const { code } = req.params;
  // Проверяем, что код состоит ровно из 6 цифр
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Код должен состоять из 6 цифр' });
  }

  // Устанавливаем дату истечения действия через 1 неделю
  const expiry_date = new Date();
  expiry_date.setDate(expiry_date.getDate() + 7);

  try {
    const insertQuery = `
      INSERT INTO keys (code, active, expiry_date)
      VALUES ($1, $2, $3)
      RETURNING id
    `;
    const { rows } = await pool.query(insertQuery, [code, true, expiry_date]);
    return res.status(201).json({
      message: 'Код успешно создан',
      id: rows[0].id,
      expiry_date,
    });
  } catch (error) {
    console.error('Ошибка при создании кода:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Такой код уже существует' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Эндпоинт для перезагрузки сервера (админский).
 * GET /admin/server/restart
 * Этот эндпоинт требует наличие заголовка x-api-key.
 * При перезапуске сервер завершает процесс через 1 секунду.
 * Если сервер запущен под PM2 или аналогичным менеджером, он автоматически перезапустится.
 */
app.get('/admin/server/restart', adminAuth, (req, res) => {
  res.json({ message: 'Сервер перезагружается...' });
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

// Настройка порта
const PORT = process.env.PORT || 3000;

// Запуск сервера: в production-режиме через HTTPS, иначе HTTP
if (process.env.NODE_ENV === 'production') {
  const httpsOptions = {
    key: fs.readFileSync(process.env.SSL_KEY_PATH),
    cert: fs.readFileSync(process.env.SSL_CERT_PATH),
  };
  https.createServer(httpsOptions, app).listen(PORT, () => {
    console.log(`Безопасный сервер запущен на порту ${PORT}`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
  });
}
