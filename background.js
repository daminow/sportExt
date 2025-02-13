// background.js
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

  // Обработка обновления вкладок
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    console.log(
      `[${getCurrentDateTime()}] [background] onUpdated: TabID=${tabId}, changeInfo=`,
      changeInfo
    );
    if (
      changeInfo.status === 'complete' &&
      tab?.url &&
      tab.url.startsWith('https://sport.innopolis.university/profile/')
    ) {
      console.log(
        `[${getCurrentDateTime()}] [background] onUpdated: URL соответствует. Открываем popup.`
      );
      chrome.action.openPopup();
    } else {
      console.log(
        `[${getCurrentDateTime()}] [background] onUpdated: URL не соответствует или страница ещё не загружена полностью.`
      );
    }
  });

  // Единый обработчик сообщений
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log(
      `[${getCurrentDateTime()}] [background] onMessage: Получено сообщение:`,
      message,
      'от',
      sender
    );
    (async () => {
      try {
        switch (message.action) {
          case 'updateSchedule': {
            console.log(
              `[${getCurrentDateTime()}] [background] updateSchedule: Обновляем расписание в хранилище.`
            );
            await setStorage({
              schedule: message.schedule,
              lastUpdated: Date.now(),
              scanningComplete: true,
            });
            console.log(
              `[${getCurrentDateTime()}] [background] updateSchedule: Расписание обновлено:`,
              message.schedule
            );
            return sendResponse({ success: true });
          }
          case 'updateWaitingList': {
            console.log(
              `[${getCurrentDateTime()}] [background] updateWaitingList: Получен запрос обновления waiting list.`
            );
            return sendResponse({ success: true });
          }
          case 'openPopup': {
            console.log(
              `[${getCurrentDateTime()}] [background] openPopup: Получена команда для открытия popup.`
            );
            chrome.action.openPopup();
            return sendResponse({ success: true });
          }
          case 'updateWaitingListStatus': {
            console.log(
              `[${getCurrentDateTime()}] [background] updateWaitingListStatus: Начало обновления статуса для слота:`,
              message.slot
            );
            const data = await getStorage('waitingList');
            const waitingLists = data.waitingList || {};
            const identifier =
              message.slot.name + message.slot.date + message.slot.start;
            for (const week in waitingLists) {
              waitingLists[week] = waitingLists[week].map((slot) => {
                if (slot.name + slot.date + slot.start === identifier) {
                  console.log(
                    `[${getCurrentDateTime()}] [background] updateWaitingListStatus: Обновление статуса для слота ${identifier} на ${
                      message.slot.status
                    }`
                  );
                  return { ...slot, status: message.slot.status };
                }
                return slot;
              });
            }
            await setStorage({ waitingList: waitingLists });
            console.log(
              `[${getCurrentDateTime()}] [background] updateWaitingListStatus: Статус обновлён для слота:`,
              message.slot,
              'Новый waiting list:',
              waitingLists
            );
            return sendResponse({ success: true });
          }
          default:
            break;
        }

        // Сообщения, требующие обращения к вкладке с нужным URL
        chrome.tabs.query(
          { url: 'https://sport.innopolis.university/profile/*' },
          (tabs) => {
            console.log(
              `[${getCurrentDateTime()}] [background] onMessage: Ищем вкладку с нужным URL...`
            );
            if (!tabs || tabs.length === 0) {
              console.warn(
                `[${getCurrentDateTime()}] [background] onMessage: Нет вкладок с нужным URL.`
              );
              return sendResponse({ error: 'Нет вкладок с нужным URL' });
            }
            const tab = tabs[0];
            console.log(
              `[${getCurrentDateTime()}] [background] onMessage: Найдена вкладка, URL: ${
                tab.url
              }`
            );

            try {
              switch (message.action) {
                case 'scanSchedule': {
                  console.log(
                    `[${getCurrentDateTime()}] [background] scanSchedule: Запрос сканирования для недели:`,
                    message.week
                  );
                  chrome.tabs.sendMessage(
                    tab.id,
                    { action: 'scanSchedule', week: message.week },
                    (response) => {
                      console.log(
                        `[${getCurrentDateTime()}] [background] scanSchedule: Ответ получен:`,
                        response
                      );
                      sendResponse({ success: true });
                    }
                  );
                  break;
                }
                case 'navigateWeek': {
                  console.log(
                    `[${getCurrentDateTime()}] [background] navigateWeek: Запрос навигации для недели:`,
                    message.week
                  );
                  chrome.tabs.sendMessage(
                    tab.id,
                    { action: 'navigateWeek', week: message.week },
                    (response) => {
                      console.log(
                        `[${getCurrentDateTime()}] [background] navigateWeek: Ответ получен:`,
                        response
                      );
                      sendResponse({ success: true });
                    }
                  );
                  break;
                }
                case 'bookSport': {
                  console.log(
                    `[${getCurrentDateTime()}] [background] bookSport: Запрос бронирования для слота:`,
                    message.slot
                  );
                  chrome.windows.getCurrent((win) => {
                    if (!win) {
                      console.error(
                        `[${getCurrentDateTime()}] [background] bookSport: Нет активного окна.`
                      );
                      return sendResponse({ error: 'Нет активного окна' });
                    }
                    chrome.scripting
                      .executeScript({
                        target: { tabId: tab.id },
                        func: bookSport,
                        args: [message.slot],
                      })
                      .then(() => {
                        console.log(
                          `[${getCurrentDateTime()}] [background] bookSport: Бронирование выполнено успешно.`
                        );
                        sendResponse({ success: true });
                      })
                      .catch((err) => {
                        console.error(
                          `[${getCurrentDateTime()}] [background] bookSport: Ошибка:`,
                          err
                        );
                        sendResponse({ error: err.message });
                      });
                  });
                  break;
                }
                case 'addToWaitingList': {
                  console.log(
                    `[${getCurrentDateTime()}] [background] addToWaitingList: Запрос добавления в waiting list для слота:`,
                    message.slot
                  );
                  addToWaitingList(message.slot);
                  sendResponse({ success: true });
                  break;
                }
                case 'scheduleBooking': {
                  console.log(
                    `[${getCurrentDateTime()}] [background] scheduleBooking: Запрос планирования бронирования для слота:`,
                    message.slot
                  );
                  chrome.tabs.sendMessage(
                    tab.id,
                    { action: 'scheduleBooking', slot: message.slot },
                    (response) => {
                      console.log(
                        `[${getCurrentDateTime()}] [background] scheduleBooking: Ответ получен:`,
                        response
                      );
                      sendResponse({ success: true });
                    }
                  );
                  break;
                }
                default:
                  console.warn(
                    `[${getCurrentDateTime()}] [background] onMessage: Неизвестное действие:`,
                    message.action
                  );
                  sendResponse({
                    warning: 'Неизвестное действие: ' + message.action,
                  });
              }
            } catch (error) {
              console.error(
                `[${getCurrentDateTime()}] [background] onMessage: Exception:`,
                error
              );
              sendResponse({ error: error.message });
            }
          }
        );
      } catch (error) {
        console.error(
          `[${getCurrentDateTime()}] [background] onMessage: Ошибка:`,
          error
        );
        sendResponse({ error: error.message });
      }
    })();
    // Возвращаем true для асинхронного sendResponse
    return true;
  });

  // Функция бронирования через chrome.scripting.executeScript
  function bookSport(slot) {
    console.log(
      `[${getCurrentDateTime()}] [bookSport] Начало попытки бронирования для слота:`,
      slot
    );
    const rows = Array.from(
      document.querySelectorAll('.swiper-slide-active .fc-list-table tr')
    );
    for (const row of rows) {
      const titleElem = row.querySelector('.fc-list-item-title a');
      const timeElem = row.querySelector('.fc-list-item-time');
      if (titleElem && timeElem && titleElem.textContent.includes(slot.name)) {
        console.log(
          `[${getCurrentDateTime()}] [bookSport] Найден слот для бронирования:`,
          slot
        );
        const checkInButton = document.querySelector(
          '.modal-content .btn-success'
        );
        if (checkInButton) {
          console.log(
            `[${getCurrentDateTime()}] [bookSport] Кнопка бронирования найдена, выполняем клик.`
          );
        } else {
          console.warn(
            `[${getCurrentDateTime()}] [bookSport] Кнопка бронирования не найдена!`
          );
        }
        checkInButton?.click();
        return;
      }
    }
    console.error(
      `[${getCurrentDateTime()}] [bookSport] Слот для бронирования не найден:`,
      slot
    );
  }

  // Функция добавления слота в waiting list
  function addToWaitingList(slot) {
    console.log(
      `[${getCurrentDateTime()}] [addToWaitingList] Начало добавления слота в waiting list:`,
      slot
    );
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

  // Вспомогательная функция для обработки добавления в waiting list
  function processAddToWaitingList(slot) {
    chrome.storage.local.get('waitingList', (data) => {
      const waitingListObj = data.waitingList || {};
      console.log(
        `[${getCurrentDateTime()}] [addToWaitingList] Текущее состояние waiting list из хранилища:`,
        waitingListObj
      );
      const weekList = waitingListObj[slot.week] || [];
      console.log(
        `[${getCurrentDateTime()}] [addToWaitingList] Текущий список для недели "${
          slot.week
        }":`,
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
          console.log(
            `[${getCurrentDateTime()}] [addToWaitingList] Элемент успешно добавлен в waiting list для недели "${
              slot.week
            }". Обновлённое состояние waiting list:`,
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
        console.log(
          `[${getCurrentDateTime()}] [addToWaitingList] Элемент уже присутствует в waiting list, добавление пропущено. Текущий слот:`,
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

  // Функция показа уведомления
  function showNotification(title, message, type) {
    console.log(
      `[${getCurrentDateTime()}] [background] showNotification: ${title} - ${message} (тип: ${type})`
    );
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
    console.log(
      `[${getCurrentDateTime()}] [background] Alarm сработал. Начало проверки waiting list.`
    );
    chrome.storage.local.get('waitingList', (data) => {
      const waitingLists = data.waitingList || {};
      const now = new Date();
      let nextCheckTime = Infinity;
      for (const week in waitingLists) {
        const list = waitingLists[week];
        if (list && list.length > 0) {
          const slot = list[0];
          console.log(
            `[${getCurrentDateTime()}] [background] Alarm: Обрабатываем слот для недели "${week}":`,
            slot
          );
          if (slot.status === 'success') {
            console.log(
              `[${getCurrentDateTime()}] [background] Alarm: Слот (${
                slot.name
              } ${slot.date} ${slot.start}) уже успешен, пропускаем.`
            );
            list.shift();
            waitingLists[week] = list;
            continue;
          }
          let bookingOffset;
          if (slot.color.includes('0, 123, 255')) {
            bookingOffset = 7 * 24 * 60 * 60 * 1000;
          } else if (
            slot.color.includes('red') ||
            slot.color.includes('rgb(255, 0, 0)')
          ) {
            bookingOffset = 7 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000;
          } else {
            bookingOffset = 7 * 24 * 60 * 60 * 1000;
          }
          const eventStart = new Date(`${slot.date}T${slot.start}:00`);
          const targetBookingTime = new Date(
            eventStart.getTime() - bookingOffset
          );
          const timeLeft = targetBookingTime - now;
          console.log(
            `[${getCurrentDateTime()}] [background] Alarm: Для слота (${
              slot.name
            }) осталось ${timeLeft} мс до открытия записи.`
          );
          if (timeLeft <= 0) {
            console.log(
              `[${getCurrentDateTime()}] [background] Alarm: Время открытия записи наступило для слота:`,
              slot
            );
            chrome.tabs.query(
              { url: 'https://sport.innopolis.university/profile/*' },
              (tabs) => {
                if (tabs.length > 0) {
                  console.log(
                    `[${getCurrentDateTime()}] [background] Alarm: Отправляем сообщение на бронирование слота через вкладку ${
                      tabs[0].id
                    }.`
                  );
                  chrome.tabs.sendMessage(
                    tabs[0].id,
                    { action: 'scheduleBooking', slot: slot },
                    (response) => {
                      console.log(
                        `[${getCurrentDateTime()}] [background] Alarm: scheduleBooking выполнено, ответ:`,
                        response
                      );
                    }
                  );
                } else {
                  console.warn(
                    `[${getCurrentDateTime()}] [background] Alarm: Активных вкладок с нужным URL не найдено.`
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
      console.log(
        `[${getCurrentDateTime()}] [background] Alarm: Итоговый waiting list после проверки:`,
        waitingLists
      );
      chrome.storage.local.set({ waitingList: waitingLists }, () => {
        console.log(
          `[${getCurrentDateTime()}] [background] Alarm: waiting list обновлён в хранилище.`
        );
      });
    });
  });

  // Создаём начальный alarm с интервалом 1 минута
  chrome.alarms.create('checkWaitingList', { delayInMinutes: 1 });
  console.log(
    `[${getCurrentDateTime()}] [background] Начальный alarm "checkWaitingList" создан с задержкой 1 минута.`
  );
})();
