// content.js
(() => {
  const getCurrentDateTime = () => new Date().toLocaleTimeString();

  const getStorage = (keys) =>
    new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (data) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(data);
      });
    });

  const setStorage = (data) =>
    new Promise((resolve, reject) => {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });

  // Функция задержки
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Функция сканирования расписания текущей недели.
   * Теперь возвращает массив schedule.
   */
  async function scanCurrentWeek() {
    const schedule = [];
    console.log(
      `[${getCurrentDateTime()}] [content] Начало сканирования расписания.`
    );

    // Получаем все строки таблицы и преобразуем NodeList в массив
    const tableRows = Array.from(
      document.querySelectorAll('.swiper-slide-active .fc-list-table tr')
    );
    // Ищем первую строку-заголовок
    let headingRow = tableRows.find((row) =>
      row.classList.contains('fc-list-heading')
    );
    let currentHeadingDate = '';
    let currentDay = '';
    if (headingRow) {
      currentHeadingDate = headingRow.getAttribute('data-date') || '';
      currentDay =
        headingRow.querySelector('.fc-list-heading-main')?.textContent.trim() ||
        '';
    } else {
      // Если заголовок не найден – используем сегодняшнюю дату
      const today = new Date();
      currentHeadingDate = today.toISOString().slice(0, 10);
      currentDay = today.toLocaleDateString();
      console.warn(
        `[${getCurrentDateTime()}] [content] fc-list-heading не найден, используется дата по умолчанию: ${currentHeadingDate}`
      );
    }

    tableRows.forEach((row) => {
      // Обновляем текущую дату из заголовка
      if (row.classList.contains('fc-list-heading')) {
        const headingDate = row.getAttribute('data-date');
        if (headingDate && isHeadingDateValid(headingDate)) {
          currentHeadingDate = headingDate;
          currentDay =
            row.querySelector('.fc-list-heading-main')?.textContent.trim() ||
            currentDay;
        }
      }
      // Обработка строки элемента расписания
      else if (row.classList.contains('fc-list-item')) {
        const timeElem = row.querySelector('.fc-list-item-time');
        const titleElem = row.querySelector('.fc-list-item-title a');
        const checkInButton = row.querySelector('.btn-success');
        if (timeElem && titleElem) {
          const times = timeElem.textContent.split(' - ');
          if (times.length < 2) return; // Пропускаем, если формат времени неверный
          const [start, finish] = times;
          const eventStart = new Date(
            `${currentHeadingDate}T${start.trim()}:00`
          );
          const now = new Date();
          // Получаем inline-стиль или computed-стиль
          const inlineBgColor = row.style.backgroundColor;
          const computedStyle = window.getComputedStyle(row);
          const backgroundColor =
            inlineBgColor || computedStyle?.backgroundColor || '';
          if (eventStart > now) {
            if (
              backgroundColor.includes('0, 123, 255') ||
              backgroundColor.includes('40, 167, 69')
            ) {
              const status = backgroundColor.includes('40, 167, 69')
                ? 'success'
                : 'waiting';
              schedule.push({
                day: currentDay,
                date: currentHeadingDate,
                start: start.trim(),
                finish: finish.trim(),
                name: titleElem.textContent.trim(),
                color: backgroundColor,
                isAvailable: checkInButton ? !checkInButton.disabled : false,
                status: status,
              });
            } else if (
              backgroundColor.includes('220, 53, 69') &&
              eventStart - now < 648000000
            ) {
              schedule.push({
                day: currentDay,
                date: currentHeadingDate,
                start: start.trim(),
                finish: finish.trim(),
                name: titleElem.textContent.trim(),
                color: backgroundColor,
                isAvailable: checkInButton ? !checkInButton.disabled : false,
                status: 'waiting',
              });
            }
          }
        }
      }
    });
    console.log(
      `[${getCurrentDateTime()}] [content] Сканирование завершено. Найдено событий: ${
        schedule.length
      }`
    );
    return schedule;
  }

  // Проверка валидности даты заголовка
  function isHeadingDateValid(dateStr) {
    const headingDate = new Date(dateStr);
    const today = new Date();
    if (headingDate.getFullYear() < today.getFullYear()) return false;
    if (headingDate.getFullYear() === today.getFullYear()) {
      if (headingDate.getMonth() < today.getMonth()) return false;
      if (
        headingDate.getMonth() === today.getMonth() &&
        headingDate.getDate() < today.getDate()
      )
        return false;
    }
    return true;
  }

  // Асинхронные обёртки для работы с текущим состоянием недели
  async function getCurrentWeekStateAsync() {
    try {
      const data = await getStorage({ currentWeekState: 'this' });
      console.log(
        `[${getCurrentDateTime()}] [content] Текущее состояние недели:`,
        data.currentWeekState
      );
      return data.currentWeekState;
    } catch (error) {
      console.error(
        `[${getCurrentDateTime()}] [content] Ошибка получения состояния недели:`,
        error
      );
      return 'this';
    }
  }

  async function setCurrentWeekStateAsync(state) {
    try {
      await setStorage({ currentWeekState: state });
      console.log(
        `[${getCurrentDateTime()}] [content] Сохранено состояние недели:`,
        state
      );
    } catch (error) {
      console.error(
        `[${getCurrentDateTime()}] [content] Ошибка сохранения состояния недели:`,
        error
      );
    }
  }

  let isNavigating = false;

  /**
   * Функция навигации по неделям.
   * После смены недели происходит повторное сканирование и добавление активных событий в waiting list.
   */
  async function navigateToWeek(targetWeek) {
    console.log(
      `[${getCurrentDateTime()}] [content] Навигация к неделе:`,
      targetWeek
    );
    let previousDate = '';
    const headingRow = document.querySelector('.fc-list-heading');
    if (headingRow) {
      previousDate = headingRow.getAttribute('data-date');
    }
    const currentWeekState = await getCurrentWeekStateAsync();
    window.currentWeekState = currentWeekState;
    if (window.currentWeekState === targetWeek) {
      const schedule = await scanCurrentWeek();
      console.log(
        `[${getCurrentDateTime()}] [content] Неделя уже соответствует. Расписание:`,
        schedule
      );
      chrome.runtime.sendMessage(
        { action: 'updateSchedule', schedule },
        (response) => {
          console.log(
            `[${getCurrentDateTime()}] [content] Ответ updateSchedule после навигации:`,
            response
          );
        }
      );
      // Добавляем активные записи в waiting list
      schedule
        .filter((ev) => ev.status === 'success')
        .forEach((ev) => {
          chrome.runtime.sendMessage(
            { action: 'addToWaitingList', slot: ev },
            (response) => {
              console.log(
                `[${getCurrentDateTime()}] [content] addToWaitingList для активной записи после навигации, ответ:`,
                response
              );
            }
          );
        });
      return;
    }

    if (targetWeek === 'next' && window.currentWeekState === 'this') {
      const nextButton = document.querySelector('.fc-next-button');
      if (nextButton) {
        console.log(
          `[${getCurrentDateTime()}] [content] Нажимаем кнопку "Следующая неделя".`
        );
        nextButton.click();
        window.currentWeekState = 'next';
      } else {
        console.error(
          `[${getCurrentDateTime()}] [content] Кнопка "Следующая неделя" не найдена.`
        );
      }
    } else if (targetWeek === 'this' && window.currentWeekState === 'next') {
      const todayButton = document.querySelector('.fc-today-button');
      if (todayButton) {
        console.log(
          `[${getCurrentDateTime()}] [content] Нажимаем кнопку "Сегодня".`
        );
        todayButton.click();
        window.currentWeekState = 'this';
      } else {
        console.error(
          `[${getCurrentDateTime()}] [content] Кнопка "Сегодня" не найдена.`
        );
      }
    }

    await setCurrentWeekStateAsync(window.currentWeekState);
    await delay(1000);
    const schedule = await scanCurrentWeek();
    console.log(
      `[${getCurrentDateTime()}] [content] Итог сканирования после навигации:`,
      schedule
    );
    chrome.runtime.sendMessage(
      { action: 'updateSchedule', schedule },
      (response) => {
        console.log(
          `[${getCurrentDateTime()}] [content] Ответ updateSchedule после навигации:`,
          response
        );
      }
    );
    schedule
      .filter((ev) => ev.status === 'success')
      .forEach((ev) => {
        chrome.runtime.sendMessage(
          { action: 'addToWaitingList', slot: ev },
          (response) => {
            console.log(
              `[${getCurrentDateTime()}] [content] addToWaitingList для активной записи после навигации, ответ:`,
              response
            );
          }
        );
      });
  }

  /**
   * Функция планирования бронирования для заданного слота.
   * После достижения рассчитанного времени попытка бронирования выполняется циклически.
   */
  async function scheduleBooking(slot) {
    console.log(
      `[${getCurrentDateTime()}] [content] Планирование бронирования для слота:`,
      slot
    );
    const eventStart = new Date(`${slot.date}T${slot.start}:00`);
    const bookingOffset = 7 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000;
    const targetBookingTime = new Date(eventStart.getTime() - bookingOffset);
    console.log(
      `[${getCurrentDateTime()}] [content] Время открытия записи рассчитано:`,
      targetBookingTime
    );
    const check = () => {
      const now = new Date();
      if (now >= targetBookingTime) {
        console.log(
          `[${getCurrentDateTime()}] [content] Время открытия записи наступило. Пытаемся забронировать слот:`,
          slot
        );
        const rows = Array.from(
          document.querySelectorAll('.swiper-slide-active .fc-list-table tr')
        );
        const targetRow = rows.find((row) => {
          const titleElem = row.querySelector('.fc-list-item-title a');
          return titleElem && titleElem.textContent.includes(slot.name);
        });
        if (targetRow) {
          targetRow.click();
          setTimeout(() => {
            const successButton = document.querySelector(
              '#group-info-modal .modal-footer .btn-success'
            );
            if (successButton && !successButton.disabled) {
              successButton.click();
              console.log(
                `[${getCurrentDateTime()}] [content] Запись успешна для слота:`,
                slot
              );
              chrome.runtime.sendMessage({
                action: 'updateWaitingListStatus',
                slot: { ...slot, status: 'success' },
              });
            } else {
              console.error(
                `[${getCurrentDateTime()}] [content] Кнопка подтверждения не найдена или недоступна для слота:`,
                slot
              );
              chrome.runtime.sendMessage({
                action: 'updateWaitingListStatus',
                slot: { ...slot, status: 'failed' },
              });
            }
          }, 500);
        } else {
          console.error(
            `[${getCurrentDateTime()}] [content] Не найдена строка для записи для слота:`,
            slot
          );
          chrome.runtime.sendMessage({
            action: 'updateWaitingListStatus',
            slot: { ...slot, status: 'failed' },
          });
        }
      } else {
        const timeLeft = targetBookingTime - now;
        console.log(
          `[${getCurrentDateTime()}] [content] До открытия записи для слота "${
            slot.name
          }" осталось ${timeLeft} мс. Проверяем через 1 сек.`
        );
        setTimeout(check, 1000);
      }
    };
    check();
  }

  // Инициализация при загрузке страницы
  async function initAfterDelay() {
    console.log(
      `[${getCurrentDateTime()}] [content] Страница загружена. Инициализация...`
    );
    try {
      const data = await getStorage({ currentWeekState: 'this' });
      console.log(
        `[${getCurrentDateTime()}] [content] Текущее состояние недели:`,
        data.currentWeekState
      );
      if (data.currentWeekState === 'next') {
        document.querySelector('.fc-next-button')?.click();
        await delay(2000);
      }
      const schedule = await scanCurrentWeek();
      console.log(
        `[${getCurrentDateTime()}] [content] Итог сканирования расписания:`,
        schedule
      );
      chrome.runtime.sendMessage(
        { action: 'updateSchedule', schedule },
        (response) => {
          console.log(
            `[${getCurrentDateTime()}] [content] Ответ updateSchedule:`,
            response
          );
        }
      );
      // Автоматически добавляем активные записи в waiting list
      schedule
        .filter((ev) => ev.status === 'success')
        .forEach((ev) => {
          chrome.runtime.sendMessage(
            { action: 'addToWaitingList', slot: ev },
            (response) => {
              console.log(
                `[${getCurrentDateTime()}] [content] addToWaitingList для активной записи, ответ:`,
                response
              );
            }
          );
        });
    } catch (error) {
      console.error(
        `[${getCurrentDateTime()}] [content] Ошибка в initAfterDelay:`,
        error
      );
    }
  }

  window.addEventListener('load', initAfterDelay);

  // Обработка кликов по кнопкам смены недели
  document.addEventListener('click', (event) => {
    const btn = event.target.closest(
      '.fc-prev-button, .fc-next-button, .fc-today-button'
    );
    if (btn) {
      console.log(
        `[${getCurrentDateTime()}] [content] Кнопка смены недели нажата, запускаем сканирование расписания.`
      );
      delay(1500).then(async () => {
        const schedule = await scanCurrentWeek();
        console.log(
          `[${getCurrentDateTime()}] [content] Сканирование после смены недели завершено. Расписание:`,
          schedule
        );
        chrome.runtime.sendMessage(
          { action: 'updateSchedule', schedule },
          (response) => {
            console.log(
              `[${getCurrentDateTime()}] [content] Ответ updateSchedule после смены недели:`,
              response
            );
          }
        );
        schedule
          .filter((ev) => ev.status === 'success')
          .forEach((ev) => {
            chrome.runtime.sendMessage(
              { action: 'addToWaitingList', slot: ev },
              (response) => {
                console.log(
                  `[${getCurrentDateTime()}] [content] addToWaitingList для активной записи после смены недели, ответ:`,
                  response
                );
              }
            );
          });
      });
    }
  });

  // Обработка входящих сообщений от background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log(
      `[${getCurrentDateTime()}] [content] Получено сообщение:`,
      message
    );
    if (message.action === 'navigateWeek') {
      navigateToWeek(message.week).then(() => sendResponse({ success: true }));
    } else if (message.action === 'scheduleBooking') {
      scheduleBooking(message.slot);
      sendResponse({ success: true });
    }
    return true;
  });
})();
