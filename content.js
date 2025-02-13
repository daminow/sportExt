// content.js
import {
  getCurrentDateTime,
  getStorage,
  setStorage,
  log,
  WEEK_IN_MS,
  HALF_DAY_IN_MS,
} from './utils.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function scanCurrentWeek() {
  const schedule = [];
  log('content', 'Начало сканирования расписания.');
  const tableRows = Array.from(
    document.querySelectorAll('.swiper-slide-active .fc-list-table tr')
  );
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
    const today = new Date();
    currentHeadingDate = today.toISOString().slice(0, 10);
    currentDay = today.toLocaleDateString();
    log(
      'content',
      `fc-list-heading не найден, используется дата по умолчанию: ${currentHeadingDate}`
    );
  }
  tableRows.forEach((row) => {
    if (row.classList.contains('fc-list-heading')) {
      const headingDate = row.getAttribute('data-date');
      if (headingDate && isHeadingDateValid(headingDate)) {
        currentHeadingDate = headingDate;
        currentDay =
          row.querySelector('.fc-list-heading-main')?.textContent.trim() ||
          currentDay;
      }
    } else if (row.classList.contains('fc-list-item')) {
      const timeElem = row.querySelector('.fc-list-item-time');
      const titleElem = row.querySelector('.fc-list-item-title a');
      const checkInButton = row.querySelector('.btn-success');
      if (timeElem && titleElem) {
        const times = timeElem.textContent.split(' - ');
        if (times.length < 2) return;
        const [start, finish] = times;
        const eventStart = new Date(`${currentHeadingDate}T${start.trim()}:00`);
        const now = new Date();
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
  log('content', `Сканирование завершено. Найдено событий: ${schedule.length}`);
  return schedule;
}

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

async function getCurrentWeekStateAsync() {
  try {
    const data = await getStorage({ currentWeekState: 'this' });
    log('content', 'Текущее состояние недели:', data.currentWeekState);
    return data.currentWeekState;
  } catch (error) {
    log('content', 'Ошибка получения состояния недели:', error);
    return 'this';
  }
}

async function setCurrentWeekStateAsync(state) {
  try {
    await setStorage({ currentWeekState: state });
    log('content', 'Сохранено состояние недели:', state);
  } catch (error) {
    log('content', 'Ошибка сохранения состояния недели:', error);
  }
}

let currentWeekState = null;

async function navigateToWeek(targetWeek) {
  log('content', 'Навигация к неделе:', targetWeek);
  let previousDate = '';
  const headingRow = document.querySelector('.fc-list-heading');
  if (headingRow) {
    previousDate = headingRow.getAttribute('data-date');
  }
  currentWeekState = await getCurrentWeekStateAsync();
  if (currentWeekState === targetWeek) {
    const schedule = await scanCurrentWeek();
    log('content', 'Неделя уже соответствует. Расписание:', schedule);
    chrome.runtime.sendMessage({ action: 'updateSchedule', schedule });
    schedule
      .filter((ev) => ev.status === 'success')
      .forEach((ev) => {
        chrome.runtime.sendMessage({ action: 'addToWaitingList', slot: ev });
      });
    return;
  }
  if (targetWeek === 'next' && currentWeekState === 'this') {
    const nextButton = document.querySelector('.fc-next-button');
    if (nextButton) {
      log('content', 'Нажимаем кнопку "Следующая неделя".');
      nextButton.click();
      currentWeekState = 'next';
    } else {
      log('content', 'Кнопка "Следующая неделя" не найдена.');
    }
  } else if (targetWeek === 'this' && currentWeekState === 'next') {
    const todayButton = document.querySelector('.fc-today-button');
    if (todayButton) {
      log('content', 'Нажимаем кнопку "Сегодня".');
      todayButton.click();
      currentWeekState = 'this';
    } else {
      log('content', 'Кнопка "Сегодня" не найдена.');
    }
  }
  await setCurrentWeekStateAsync(currentWeekState);
  await delay(1000);
  const schedule = await scanCurrentWeek();
  log('content', 'Итог сканирования после навигации:', schedule);
  chrome.runtime.sendMessage({ action: 'updateSchedule', schedule });
  schedule
    .filter((ev) => ev.status === 'success')
    .forEach((ev) => {
      chrome.runtime.sendMessage({ action: 'addToWaitingList', slot: ev });
    });
}

async function scheduleBooking(slot) {
  log('content', 'Планирование бронирования для слота:', slot);
  const eventStart = new Date(`${slot.date}T${slot.start}:00`);
  const bookingOffset = WEEK_IN_MS + HALF_DAY_IN_MS;
  const targetBookingTime = new Date(eventStart.getTime() - bookingOffset);
  log('content', 'Время открытия записи рассчитано:', targetBookingTime);
  const check = () => {
    const now = new Date();
    if (now >= targetBookingTime) {
      log(
        'content',
        'Время открытия записи наступило. Пытаемся забронировать слот:',
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
            log('content', 'Запись успешна для слота:', slot);
            chrome.runtime.sendMessage({
              action: 'updateWaitingListStatus',
              slot: { ...slot, status: 'success' },
            });
          } else {
            log(
              'content',
              'Кнопка подтверждения не найдена или недоступна для слота:',
              slot
            );
            chrome.runtime.sendMessage({
              action: 'updateWaitingListStatus',
              slot: { ...slot, status: 'failed' },
            });
          }
        }, 500);
      } else {
        log('content', 'Не найдена строка для записи для слота:', slot);
        chrome.runtime.sendMessage({
          action: 'updateWaitingListStatus',
          slot: { ...slot, status: 'failed' },
        });
      }
    } else {
      const timeLeft = targetBookingTime - now;
      log(
        'content',
        `До открытия записи для слота "${slot.name}" осталось ${timeLeft} мс. Проверяем через 1 сек.`
      );
      setTimeout(check, 1000);
    }
  };
  check();
}

async function initAfterDelay() {
  log('content', 'Страница загружена. Инициализация...');
  try {
    const data = await getStorage({ currentWeekState: 'this' });
    log('content', 'Текущее состояние недели:', data.currentWeekState);
    if (data.currentWeekState === 'next') {
      document.querySelector('.fc-next-button')?.click();
      await delay(2000);
    }
    const schedule = await scanCurrentWeek();
    log('content', 'Итог сканирования расписания:', schedule);
    chrome.runtime.sendMessage({ action: 'updateSchedule', schedule });
    schedule
      .filter((ev) => ev.status === 'success')
      .forEach((ev) => {
        chrome.runtime.sendMessage({ action: 'addToWaitingList', slot: ev });
      });
  } catch (error) {
    log('content', 'Ошибка в initAfterDelay:', error);
  }
}

window.addEventListener('load', initAfterDelay);

document.addEventListener('click', (event) => {
  const btn = event.target.closest(
    '.fc-prev-button, .fc-next-button, .fc-today-button'
  );
  if (btn) {
    log(
      'content',
      'Кнопка смены недели нажата, запускаем сканирование расписания.'
    );
    delay(1500).then(async () => {
      const schedule = await scanCurrentWeek();
      log(
        'content',
        'Сканирование после смены недели завершено. Расписание:',
        schedule
      );
      chrome.runtime.sendMessage(
        { action: 'updateSchedule', schedule },
        (response) => {
          log('content', 'Ответ updateSchedule после смены недели:', response);
        }
      );
      schedule
        .filter((ev) => ev.status === 'success')
        .forEach((ev) => {
          chrome.runtime.sendMessage(
            { action: 'addToWaitingList', slot: ev },
            (response) => {
              log(
                'content',
                'addToWaitingList для активной записи после смены недели, ответ:',
                response
              );
            }
          );
        });
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log('content', 'Получено сообщение:', message);
  if (message.action === 'navigateWeek') {
    navigateToWeek(message.week).then(() => sendResponse({ success: true }));
  } else if (message.action === 'scheduleBooking') {
    scheduleBooking(message.slot);
    sendResponse({ success: true });
  }
  return true;
});
