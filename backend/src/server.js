const express = require('express');
const { Pool } = require('pg');
const helmet = require('helmet');
const https = require('https');
const fs = require('fs');
const morgan = require('morgan');

const app = express();

// Устанавливаем безопасные HTTP-заголовки
app.use(helmet());

// Логирование запросов (удобно в режиме разработки)
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Для парсинга JSON в теле запроса
app.use(express.json());

// Настройка подключения к базе данных PostgreSQL через переменную окружения
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Если требуется SSL (например, на Heroku), раскомментируйте:
  // ssl: { rejectUnauthorized: false }
});

// Middleware для защиты эндпоинта добавления новых кодов
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
    // Используем параметризованный запрос для защиты от SQL-инъекций
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
 * Эндпоинт для добавления нового кода.
 * POST /projects/sportext/add
 * Доступ защищён посредством adminAuth (заголовок x-api-key должен соответствовать значению переменной ADMIN_API_KEY)
 */
app.post('/projects/sportext/add', adminAuth, async (req, res) => {
  const { code, active, expiry_date } = req.body;

  // Валидация входных данных
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
    // Если значение active не передано, по умолчанию устанавливаем true
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
    // Обработка ошибки дублирования кода (уникальное ограничение)
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Код уже существует' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Определяем порт сервера
const PORT = process.env.PORT || 3000;

// Запуск сервера через HTTPS в production-среде или обычным HTTP в разработке
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
