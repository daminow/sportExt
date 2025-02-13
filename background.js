// background.js
import {
  getCurrentDateTime,
  getStorage,
  setStorage,
  log,
  WEEK_IN_MS,
  HALF_DAY_IN_MS,
} from './utils.js';

// Отслеживание обновления вкладок
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  log('background', `onUpdated: TabID=${tabId}, changeInfo=`, changeInfo);
  if (
    changeInfo.status === 'complete' &&
    tab?.url &&
    tab.url.startsWith('https://sport.innopolis.university/profile/')
  ) {
    log('background', 'URL соответствует. Открываем popup.');
    chrome.action.openPopup();
  } else {
    log(
      'background',
      'URL не соответствует или страница ещё не загружена полностью.'
    );
  }
});

// Валидация входящего сообщения
function validateMessage(message) {
  return message && typeof message.action === 'string';
}

// Обработка сообщений
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (!validateMessage(message)) {
        throw new Error('Неверное сообщение');
      }
      // Обработка команд, которые можно выполнить сразу
      switch (message.action) {
        case 'updateSchedule': {
          log(
            'background',
            'updateSchedule: Обновляем расписание в хранилище.'
          );
          await setStorage({
            schedule: message.schedule,
            lastUpdated: Date.now(),
            scanningComplete: true,
          });
          log(
            'background',
            'updateSchedule: Расписание обновлено:',
            message.schedule
          );
          sendResponse({ success: true });
          return;
        }
        case 'updateWaitingList': {
          log(
            'background',
            'updateWaitingList: Получен запрос обновления waiting list.'
          );
          sendResponse({ success: true });
          return;
        }
        case 'openPopup': {
          log('background', 'openPopup: Получена команда для открытия popup.');
          chrome.action.openPopup();
          sendResponse({ success: true });
          return;
        }
        case 'updateWaitingListStatus': {
          log(
            'background',
            'updateWaitingListStatus: Начало обновления статуса для слота:',
            message.slot
          );
          const data = await getStorage('waitingList');
          const waitingLists = data.waitingList || {};
          const identifier =
            message.slot.name + message.slot.date + message.slot.start;
          for (const week in waitingLists) {
            waitingLists[week] = waitingLists[week].map((slot) => {
              if (slot.name + slot.date + slot.start === identifier) {
                log(
                  'background',
                  `updateWaitingListStatus: Обновление статуса для слота ${identifier} на ${message.slot.status}`
                );
                return { ...slot, status: message.slot.status };
              }
              return slot;
            });
          }
          await setStorage({ waitingList: waitingLists });
          log(
            'background',
            'updateWaitingListStatus: Статус обновлён для слота:',
            message.slot,
            'Новый waiting list:',
            waitingLists
          );
          sendResponse({ success: true });
          return;
        }
        default:
          break;
      }

      // Команды, требующие обращения к вкладке с нужным URL
      chrome.tabs.query(
        { url: 'https://sport.innopolis.university/profile/*' },
        (tabs) => {
          log('background', 'onMessage: Ищем вкладку с нужным URL...');
          if (!tabs || tabs.length === 0) {
            log('background', 'onMessage: Нет вкладок с нужным URL.');
            sendResponse({ error: 'Нет вкладок с нужным URL' });
            return;
          }
          const tab = tabs[0];
          log('background', `onMessage: Найдена вкладка, URL: ${tab.url}`);

          try {
            switch (message.action) {
              case 'scanSchedule': {
                log(
                  'background',
                  'scanSchedule: Запрос сканирования для недели:',
                  message.week
                );
                chrome.tabs.sendMessage(
                  tab.id,
                  { action: 'scanSchedule', week: message.week },
                  (response) => {
                    log('background', 'scanSchedule: Ответ получен:', response);
                    sendResponse({ success: true });
                  }
                );
                break;
              }
              case 'navigateWeek': {
                log(
                  'background',
                  'navigateWeek: Запрос навигации для недели:',
                  message.week
                );
                chrome.tabs.sendMessage(
                  tab.id,
                  { action: 'navigateWeek', week: message.week },
                  (response) => {
                    log('background', 'navigateWeek: Ответ получен:', response);
                    sendResponse({ success: true });
                  }
                );
                break;
              }
              case 'bookSport': {
                log(
                  'background',
                  'bookSport: Запрос бронирования для слота:',
                  message.slot
                );
                chrome.windows.getCurrent((win) => {
                  if (!win) {
                    log('background', 'bookSport: Нет активного окна.');
                    sendResponse({ error: 'Нет активного окна' });
                    return;
                  }
                  chrome.scripting
                    .executeScript({
                      target: { tabId: tab.id },
                      func: bookSport,
                      args: [message.slot],
                    })
                    .then(() => {
                      log(
                        'background',
                        'bookSport: Бронирование выполнено успешно.'
                      );
                      sendResponse({ success: true });
                    })
                    .catch((err) => {
                      log('background', 'bookSport: Ошибка:', err);
                      sendResponse({ error: err.message });
                    });
                });
                break;
              }
              case 'addToWaitingList': {
                log(
                  'background',
                  'addToWaitingList: Запрос добавления в waiting list для слота:',
                  message.slot
                );
                addToWaitingList(message.slot);
                sendResponse({ success: true });
                break;
              }
              case 'scheduleBooking': {
                log(
                  'background',
                  'scheduleBooking: Запрос планирования бронирования для слота:',
                  message.slot
                );
                chrome.tabs.sendMessage(
                  tab.id,
                  { action: 'scheduleBooking', slot: message.slot },
                  (response) => {
                    log(
                      'background',
                      'scheduleBooking: Ответ получен:',
                      response
                    );
                    sendResponse({ success: true });
                  }
                );
                break;
              }
              default: {
                log(
                  'background',
                  'onMessage: Неизвестное действие:',
                  message.action
                );
                sendResponse({
                  warning: 'Неизвестное действие: ' + message.action,
                });
                break;
              }
            }
          } catch (error) {
            log('background', 'onMessage: Exception:', error);
            sendResponse({ error: error.message });
          }
        }
      );
    } catch (error) {
      log('background', 'onMessage: Ошибка:', error);
      sendResponse({ error: error.message });
    }
  })();
  return true; // Указываем, что ответ будет отправлен асинхронно
});

// Функция бронирования (выполняется в контексте страницы)
function bookSport(slot) {
  log('bookSport', 'Начало попытки бронирования для слота:', slot);
  const rows = Array.from(
    document.querySelectorAll('.swiper-slide-active .fc-list-table tr')
  );
  for (const row of rows) {
    const titleElem = row.querySelector('.fc-list-item-title a');
    const timeElem = row.querySelector('.fc-list-item-time');
    if (titleElem && timeElem && titleElem.textContent.includes(slot.name)) {
      log('bookSport', 'Найден слот для бронирования:', slot);
      const checkInButton = document.querySelector(
        '.modal-content .btn-success'
      );
      if (checkInButton) {
        log('bookSport', 'Кнопка бронирования найдена, выполняем клик.');
        checkInButton.click();
      } else {
        log('bookSport', 'Кнопка бронирования не найдена!');
      }
      return;
    }
  }
  log('bookSport', 'Слот для бронирования не найден:', slot);
}

// Добавление слота в waiting list
function addToWaitingList(slot) {
  log('addToWaitingList', 'Начало добавления слота в waiting list:', slot);
  if (slot.status !== 'success') {
    slot.status = 'waiting';
  }
  if (!slot.week) {
    chrome.storage.local.get({ currentWeekState: 'this' }, (data) => {
      slot.week = data.currentWeekState;
      processAddToWaitingList(slot);
    });
  } else {
    processAddToWaitingList(slot);
  }
}

function processAddToWaitingList(slot) {
  chrome.storage.local.get('waitingList', (data) => {
    const waitingListObj = data.waitingList || {};
    log(
      'addToWaitingList',
      'Текущее состояние waiting list из хранилища:',
      waitingListObj
    );
    const weekList = waitingListObj[slot.week] || [];
    log(
      'addToWaitingList',
      `Текущий список для недели "${slot.week}":`,
      weekList
    );
    const identifier = slot.name + slot.date + slot.start;
    if (
      !weekList.some(
        (item) => item.name + item.date + item.start === identifier
      )
    ) {
      weekList.unshift(slot);
      waitingListObj[slot.week] = weekList;
      chrome.storage.local.set({ waitingList: waitingListObj }, () => {
        log(
          'addToWaitingList',
          `Элемент успешно добавлен в waiting list для недели "${slot.week}". Обновлённое состояние waiting list:`,
          waitingListObj
        );
      });
      showNotification(
        slot.status === 'success'
          ? 'Запись подтверждена'
          : 'Добавлено в лист ожидания',
        `${slot.name} (${slot.day})`,
        'info'
      );
    } else {
      log(
        'addToWaitingList',
        'Элемент уже присутствует в waiting list, добавление пропущено. Текущий слот:',
        slot
      );
      showNotification(
        'Уже в листе ожидания',
        `${slot.name} (${slot.day})`,
        'info'
      );
    }
  });
}

function showNotification(title, message, type) {
  log('background', `showNotification: ${title} - ${message} (тип: ${type})`);
  chrome.notifications.create('', {
    type: 'basic',
    iconUrl: 'icon.png',
    title: title,
    message: message,
    priority: type === 'error' ? 2 : 0,
  });
}

// Обработка alarm для проверки waiting list
chrome.alarms.onAlarm.addListener(async () => {
  log('background', 'Alarm сработал. Начало проверки waiting list.');
  chrome.storage.local.get('waitingList', (data) => {
    const waitingLists = data.waitingList || {};
    const now = new Date();
    let nextCheckTime = Infinity;
    for (const week in waitingLists) {
      const list = waitingLists[week];
      if (list && list.length > 0) {
        const slot = list[0];
        log(
          'background',
          `Alarm: Обрабатываем слот для недели "${week}":`,
          slot
        );
        if (slot.status === 'success') {
          log(
            'background',
            `Alarm: Слот (${slot.name} ${slot.date} ${slot.start}) уже успешен, пропускаем.`
          );
          list.shift();
          waitingLists[week] = list;
          continue;
        }
        let bookingOffset;
        if (slot.color.includes('0, 123, 255')) {
          bookingOffset = WEEK_IN_MS;
        } else if (
          slot.color.includes('red') ||
          slot.color.includes('rgb(255, 0, 0)')
        ) {
          bookingOffset = WEEK_IN_MS + HALF_DAY_IN_MS;
        } else {
          bookingOffset = WEEK_IN_MS;
        }
        const eventStart = new Date(`${slot.date}T${slot.start}:00`);
        const targetBookingTime = new Date(
          eventStart.getTime() - bookingOffset
        );
        const timeLeft = targetBookingTime - now;
        log(
          'background',
          `Alarm: Для слота (${slot.name}) осталось ${timeLeft} мс до открытия записи.`
        );
        if (timeLeft <= 0) {
          log(
            'background',
            'Alarm: Время открытия записи наступило для слота:',
            slot
          );
          chrome.tabs.query(
            { url: 'https://sport.innopolis.university/profile/*' },
            (tabs) => {
              if (tabs.length > 0) {
                log(
                  'background',
                  `Alarm: Отправляем сообщение на бронирование слота через вкладку ${tabs[0].id}.`
                );
                chrome.tabs.sendMessage(
                  tabs[0].id,
                  { action: 'scheduleBooking', slot: slot },
                  (response) => {
                    log(
                      'background',
                      'Alarm: scheduleBooking выполнено, ответ:',
                      response
                    );
                  }
                );
              } else {
                log(
                  'background',
                  'Alarm: Активных вкладок с нужным URL не найдено.'
                );
              }
            }
          );
          list.shift();
          waitingLists[week] = list;
        } else {
          if (timeLeft < nextCheckTime) nextCheckTime = timeLeft;
        }
      }
    }
    log(
      'background',
      'Alarm: Итоговый waiting list после проверки:',
      waitingLists
    );
    chrome.storage.local.set({ waitingList: waitingLists }, () => {
      log('background', 'Alarm: waiting list обновлён в хранилище.');
    });
  });
});

// Создаём начальный alarm (интервал 1 минута)
chrome.alarms.create('checkWaitingList', { delayInMinutes: 1 });
log(
  'background',
  'Начальный alarm "checkWaitingList" создан с задержкой 1 минута.'
);
