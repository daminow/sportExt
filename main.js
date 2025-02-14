// main.js
// ============ Общие утилиты ================
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const log = (module, message, ...args) =>
  console.log(`[${getCurrentDateTime()}] [${module}] ${message}`, ...args);

// Определяем, в каком контексте мы находимся
const isBackground = typeof document === 'undefined';
const isPopup =
  typeof document !== 'undefined' && location.protocol === 'chrome-extension:';
const isContent =
  typeof document !== 'undefined' && location.protocol.startsWith('http');

// ============ КОД BACKGROUND (service worker) ================
if (isBackground) {
  // Функция бронирования через chrome.scripting.executeScript
  function bookSport(slot) {
    log('bookSport', 'Начало попытки бронирования для слота:', slot);
    const rows = Array.from(
      document.querySelectorAll('.swiper-slide-active .fc-list-table tr')
    );
    let currentDate = '';
    for (const row of rows) {
      // Если найден заголовок – обновляем текущую дату
      if (row.classList.contains('fc-list-heading')) {
        currentDate = row.getAttribute('data-date') || '';
        continue;
      }
      if (row.classList.contains('fc-list-item')) {
        const titleElem = row.querySelector('.fc-list-item-title a');
        const timeElem = row.querySelector('.fc-list-item-time');
        if (!titleElem || !timeElem) continue;
        const times = timeElem.textContent.split(' - ');
        // Проверяем совпадение даты, названия и времени начала
        if (
          currentDate === slot.date &&
          titleElem.textContent.includes(slot.name) &&
          times[0].trim() === slot.start
        ) {
          log('bookSport', 'Найден корректный слот для бронирования:', slot);
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
    }
    log('bookSport', 'Слот для бронирования не найден:', slot);
  }

  // Функции для работы с waiting list
  function addToWaitingList(slot) {
    log('addToWaitingList', 'Начало добавления слота в waiting list:', slot);
    if (slot.status !== 'success') slot.status = 'waiting';
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
            `Элемент успешно добавлен в waiting list для недели "${slot.week}". Обновлённое состояние:`,
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
          'Элемент уже присутствует в waiting list. Пропуск:',
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
    log('showNotification', `${title} - ${message} (тип: ${type})`);
    chrome.notifications.create('', {
      type: 'basic',
      iconUrl: 'icon.png',
      title,
      message,
      priority: type === 'error' ? 2 : 0,
    });
  }

  // Обработка обновления вкладок
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    log('background', `onUpdated: TabID=${tabId}, changeInfo=`, changeInfo);
    if (
      changeInfo.status === 'complete' &&
      tab?.url &&
      tab.url.startsWith('https://sport.innopolis.university/profile/')
    ) {
      log('background', 'URL соответствует – открываем popup.');
      chrome.action.openPopup();
    } else {
      log(
        'background',
        'URL не соответствует или страница ещё не загружена полностью.'
      );
    }
  });

  // Единый обработчик сообщений
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log('background', 'onMessage: Получено сообщение:', message, 'от', sender);
    (async () => {
      try {
        switch (message.action) {
          case 'updateSchedule': {
            log('background', 'updateSchedule: Обновляем расписание.');
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
            return sendResponse({ success: true });
          }
          case 'updateWaitingList': {
            log(
              'background',
              'updateWaitingList: Запрос обновления waiting list.'
            );
            return sendResponse({ success: true });
          }
          case 'openPopup': {
            log('background', 'openPopup: Открытие popup.');
            chrome.action.openPopup();
            return sendResponse({ success: true });
          }
          case 'updateWaitingListStatus': {
            log(
              'background',
              'updateWaitingListStatus: Обновление статуса для слота:',
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
                    `Обновление статуса для слота ${identifier} на ${message.slot.status}`
                  );
                  return { ...slot, status: message.slot.status };
                }
                return slot;
              });
            }
            await setStorage({ waitingList: waitingLists });
            log(
              'background',
              'Статус обновлён для слота:',
              message.slot,
              'Новый waiting list:',
              waitingLists
            );
            return sendResponse({ success: true });
          }
          default:
            break;
        }

        // Для сообщений, требующих поиска вкладки с нужным URL
        chrome.tabs.query(
          { url: 'https://sport.innopolis.university/profile/*' },
          (tabs) => {
            log('background', 'Ищем вкладку с нужным URL...');
            if (!tabs || tabs.length === 0) {
              console.warn('background', 'Нет вкладок с нужным URL.');
              return sendResponse({ error: 'Нет вкладок с нужным URL' });
            }
            const tab = tabs[0];
            log('background', `Найдена вкладка, URL: ${tab.url}`);
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
                      log(
                        'background',
                        'scanSchedule: Ответ получен:',
                        response
                      );
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
                      log(
                        'background',
                        'navigateWeek: Ответ получен:',
                        response
                      );
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
                      log('background', 'Нет активного окна.');
                      return sendResponse({ error: 'Нет активного окна' });
                    }
                    chrome.scripting
                      .executeScript({
                        target: { tabId: tab.id },
                        func: bookSport,
                        args: [message.slot],
                      })
                      .then(() => {
                        log('background', 'Бронирование выполнено успешно.');
                        sendResponse({ success: true });
                      })
                      .catch((err) => {
                        log('background', 'Ошибка бронирования:', err);
                        sendResponse({ error: err.message });
                      });
                  });
                  break;
                }
                case 'addToWaitingList': {
                  log(
                    'background',
                    'addToWaitingList: Добавление в waiting list для слота:',
                    message.slot
                  );
                  addToWaitingList(message.slot);
                  sendResponse({ success: true });
                  break;
                }
                case 'scheduleBooking': {
                  log(
                    'background',
                    'scheduleBooking: Планирование бронирования для слота:',
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
                default:
                  console.warn(
                    'background',
                    'Неизвестное действие:',
                    message.action
                  );
                  sendResponse({
                    warning: 'Неизвестное действие: ' + message.action,
                  });
              }
            } catch (error) {
              log('background', 'Exception:', error);
              sendResponse({ error: error.message });
            }
          }
        );
      } catch (error) {
        log('background', 'Ошибка в onMessage:', error);
        sendResponse({ error: error.message });
      }
    })();
    return true; // Асинхронный ответ
  });

  // Обработка alarm для проверки waiting list
  chrome.alarms.onAlarm.addListener(async () => {
    log('background', 'Alarm сработал. Проверка waiting list.');
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
              `Alarm: Слот (${slot.name} ${slot.date} ${slot.start}) уже успешен, пропуск.`
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
          log(
            'background',
            `Alarm: Для слота (${slot.name}) осталось ${timeLeft} мс до открытия записи.`
          );
          if (timeLeft <= 0) {
            log('background', 'Alarm: Время записи наступило для слота:', slot);
            chrome.tabs.query(
              { url: 'https://sport.innopolis.university/profile/*' },
              (tabs) => {
                if (tabs.length > 0) {
                  log(
                    'background',
                    `Alarm: Отправляем scheduleBooking через вкладку ${tabs[0].id}.`
                  );
                  chrome.tabs.sendMessage(
                    tabs[0].id,
                    { action: 'scheduleBooking', slot },
                    (response) => {
                      log(
                        'background',
                        'Alarm: scheduleBooking выполнено, ответ:',
                        response
                      );
                    }
                  );
                } else {
                  console.warn(
                    'background',
                    'Alarm: Нет активных вкладок с нужным URL.'
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
      log('background', 'Alarm: Итоговый waiting list:', waitingLists);
      chrome.storage.local.set({ waitingList: waitingLists }, () => {
        log('background', 'Alarm: waiting list обновлён.');
      });
    });
  });

  // Создаём alarm с задержкой 1 минута
  chrome.alarms.create('checkWaitingList', { delayInMinutes: 1 });
  log('background', 'Начальный alarm "checkWaitingList" создан (1 минута).');
}

// ============ КОД POPUP ================
if (isPopup) {
  window.addEventListener('load', () => {
    log('popup', 'Интерфейс расширения открыт.');
  });
  window.addEventListener('unload', () => {
    log('popup', 'Интерфейс расширения закрыт.');
  });

  // Универсальная функция создания элемента
  function createElement(tag = 'div', text = '', classList = [], attrs = {}) {
    const element = document.createElement(tag);
    element.classList.add(...classList);
    element.innerHTML = text;
    Object.entries(attrs).forEach(([key, value]) => {
      element[key] = value;
    });
    return element;
  }

  function useLoading(show) {
    const loader = document.querySelector('.loader__box');
    if (!loader) return;
    if (show) {
      loader.style.display = 'flex';
      loader.style.opacity = '1';
      log('popup', 'Loading ON');
    } else {
      loader.style.opacity = '0';
      loader.style.display = 'none';
      log('popup', 'Loading OFF');
    }
  }

  function savePopupState(state) {
    setStorage({ popupState: state })
      .then(() => log('popup', 'Состояние сохранено:', state))
      .catch((error) =>
        console.error(
          `[${getCurrentDateTime()}] [popup] Ошибка сохранения:`,
          error
        )
      );
  }

  async function restorePopupState() {
    try {
      const data = await getStorage('popupState');
      log('popup', 'Восстановлено состояние:', data.popupState);
      if (data.popupState) {
        selectedWeek = data.popupState.selectedWeek || selectedWeek;
        selectedSort = data.popupState.selectedSort || selectedSort;
      }
    } catch (error) {
      console.error(
        `[${getCurrentDateTime()}] [popup] Ошибка восстановления:`,
        error
      );
    }
  }

  let scheduleData = [];
  let selectedWeek = 'this';
  let selectedSort = 'sport';
  let selectedOption = null;
  let loadRetries = 0;
  const maxRetries = 20;

  async function loadSchedule() {
    try {
      const data = await getStorage(['schedule', 'scanningComplete']);
      scheduleData = data.schedule || [];
      log('popup', 'Загружено расписание:', scheduleData);
      if (!data.scanningComplete) {
        log('popup', `Сканирование не завершено (retry ${loadRetries}).`);
        loadRetries++;
        if (loadRetries < maxRetries) setTimeout(loadSchedule, 500);
        else {
          console.warn('popup', 'Превышено число попыток ожидания.');
          updateSelects();
          useLoading(false);
        }
      } else {
        updateSelects();
        useLoading(false);
      }
    } catch (error) {
      console.error('popup', 'Ошибка загрузки расписания:', error);
      useLoading(false);
    }
  }

  function updateSelects() {
    useLoading(true);
    const container = document.querySelector('.book__box');
    container.innerHTML = '';
    const mainSelect = createElement('select', '', ['book__select']);
    container.append(mainSelect);

    if (selectedSort === 'sport') {
      mainSelect.append(
        createElement('option', 'Select sport', ['book__select-item'], {
          disabled: true,
          selected: true,
        })
      );
      const sports = [...new Set(scheduleData.map((ev) => ev.name))];
      log('popup', 'Доступные виды спорта:', sports);
      sports.forEach((sport) => {
        const option = createElement('option', sport, ['book__select-item'], {
          value: sport,
        });
        mainSelect.append(option);
      });
    } else {
      mainSelect.append(
        createElement('option', 'Select day', ['book__select-item'], {
          disabled: true,
          selected: true,
        })
      );
      const days = [...new Set(scheduleData.map((ev) => ev.day))];
      log('popup', 'Доступные дни:', days);
      days.forEach((day) => {
        const option = createElement('option', day, ['book__select-item'], {
          value: day,
        });
        mainSelect.append(option);
      });
    }
    sortSelectChange(mainSelect);
    useLoading(false);
  }

  function sortSelectChange(mainSelect) {
    const oldBtn = document.querySelector('.book__btn');
    if (oldBtn) oldBtn.remove();

    mainSelect.addEventListener('change', () => {
      useLoading(true);
      selectedOption = mainSelect.value;
      log('popup', 'Основной select изменён:', selectedOption);
      updateAndSaveState();

      const oldSecondSelect = document.querySelector('.select-2');
      if (oldSecondSelect) oldSecondSelect.remove();

      const container = document.querySelector('.book__box');
      let filtered =
        selectedSort === 'sport'
          ? scheduleData.filter((ev) => ev.name === selectedOption)
          : scheduleData.filter((ev) => ev.day === selectedOption);

      const secondSelect = createElement('select', '', [
        'book__select',
        'select-2',
      ]);
      container.append(secondSelect);
      secondSelect.append(
        createElement('option', 'Select time', ['book__select-item'], {
          disabled: true,
          selected: true,
        })
      );

      filtered.forEach((ev) => {
        const text =
          selectedSort === 'sport'
            ? `${ev.day} | ${ev.start} - ${ev.finish}`
            : `${ev.start} - ${ev.finish} | ${ev.name}`;
        secondSelect.append(
          createElement('option', text, ['book__select-item'], {
            value: JSON.stringify(ev),
          })
        );
      });
      secondSelect.addEventListener('change', () =>
        changeLastSelect(mainSelect, secondSelect)
      );
      useLoading(false);
    });
  }

  function updateAndSaveState() {
    const state = { selectedWeek, selectedSort };
    log('popup', 'Обновление состояния:', state);
    savePopupState(state);
  }

  function changeLastSelect(mainSelect, secondSelect) {
    const oldBtn = document.querySelector('.book__btn');
    if (oldBtn) oldBtn.remove();
    const container = document.querySelector('.book__box');
    const bookBtn = createElement('button', 'Create booking', [
      'btn-reset',
      'book__btn',
    ]);
    container.append(bookBtn);
    bookBtn.style.display = 'block';
    bookBtn.style.opacity = '1';
    bookBtn.addEventListener('click', () => {
      const value1 = mainSelect.value;
      const value2 = secondSelect.value;
      log('popup', 'Нажата кнопка бронирования:', value1, value2);
      updateAndSaveState();
      book(value1, value2);
    });
  }

  function book(value1, value2) {
    if (!value1 || !value2) return;
    const selectedEvent = JSON.parse(value2);
    selectedEvent.week = selectedWeek;
    log('popup', 'Событие для бронирования:', selectedEvent);
    useLoading(true);
    chrome.runtime.sendMessage(
      { action: 'addToWaitingList', slot: selectedEvent },
      (response) => {
        log('popup', 'Ответ addToWaitingList:', response);
        useLoading(false);
        updateWaitingList();
        chrome.runtime.sendMessage(
          { action: 'scheduleBooking', slot: selectedEvent },
          (resp) => {
            log('popup', 'Запуск scheduleBooking, ответ:', resp);
          }
        );
      }
    );
  }

  function updateWaitingList() {
    chrome.storage.local.get('waitingList', (data) => {
      log('popup', 'Обновление waiting list:', data.waitingList);
      const container = document.querySelector('.waiting__list');
      if (!container) {
        console.error('popup', 'Контейнер waiting list не найден.');
        return;
      }
      container.innerHTML = '';
      const waitingLists = data.waitingList || {};
      log('popup', 'Выбранная неделя:', selectedWeek);
      const currentList = waitingLists[selectedWeek] || [];
      if (currentList.length > 0) {
        const header = createElement('h4', `Week: ${selectedWeek}`, [
          'waiting-header',
        ]);
        container.appendChild(header);
        currentList.forEach((slot) => {
          const li = createElement('li');
          li.className = 'waiting-item';
          li.textContent = `${slot.start} - ${slot.finish} | ${slot.name} (${slot.day}) [${slot.status}]`;
          li.style.backgroundColor =
            slot.status === 'success'
              ? 'lightgreen'
              : slot.status === 'failed'
              ? 'lightcoral'
              : 'lightyellow';
          const delBtn = createElement('span', '✖', ['delete-btn']);
          delBtn.addEventListener('click', () => {
            log('popup', 'Удаление элемента:', slot);
            removeWaitingItem(slot);
          });
          li.appendChild(delBtn);
          container.appendChild(li);
        });
      } else {
        container.innerHTML = `<p>No entries for week "${selectedWeek}"</p>`;
      }
    });
  }

  function removeWaitingItem(slotToRemove) {
    chrome.storage.local.get('waitingList', (data) => {
      const waitingLists = data.waitingList || {};
      const identifier =
        slotToRemove.name + slotToRemove.date + slotToRemove.start;
      for (const week in waitingLists) {
        waitingLists[week] = waitingLists[week].filter(
          (slot) => slot.name + slot.date + slot.start !== identifier
        );
      }
      chrome.storage.local.set({ waitingList: waitingLists }, () => {
        log('popup', 'Элемент удалён:', slotToRemove);
        updateWaitingList();
      });
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.waitingList) {
      log('popup', 'waiting list обновлён.');
      updateWaitingList();
    }
    if (areaName === 'local' && changes.schedule) {
      log('popup', 'Расписание обновлено.');
      loadSchedule();
    }
  });

  async function initUI() {
    useLoading(true);
    log('popup', 'Инициализация UI popup...');
    await restorePopupState();

    const weekRadios = document.querySelectorAll('input[name="week-type"]');
    const sortRadios = document.querySelectorAll('input[name="sort-type"]');

    weekRadios.forEach((radio) => {
      radio.checked = radio.value === selectedWeek;
    });
    sortRadios.forEach((radio) => {
      const lbl = radio.nextElementSibling.textContent.trim().toLowerCase();
      radio.checked = lbl === selectedSort;
    });

    updateAndSaveState();
    loadSchedule();
    updateWaitingList();
    useLoading(false);

    sortRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        useLoading(true);
        selectedSort =
          radio.nextElementSibling.textContent.trim().toLowerCase() === 'day'
            ? 'day'
            : 'sport';
        log('popup', 'Тип сортировки изменён:', selectedSort);
        selectedOption = null;
        updateAndSaveState();
        loadSchedule();
      });
    });

    weekRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        useLoading(true);
        selectedWeek = radio.value;
        log('popup', 'Неделя изменена:', selectedWeek);
        updateAndSaveState();
        selectedOption = null;
        chrome.runtime.sendMessage(
          { action: 'navigateWeek', week: selectedWeek },
          (response) => {
            if (chrome.runtime.lastError)
              console.error(
                'popup',
                'Ошибка navigateWeek:',
                chrome.runtime.lastError.message
              );
            log('popup', 'Ответ navigateWeek:', response);
            loadSchedule();
            updateWaitingList();
            useLoading(false);
          }
        );
      });
    });
  }

  window.addEventListener('load', () => {
    useLoading(true);
    log('popup', 'Инициализация popup UI...');
    initUI();
  });
}

// ============ КОД CONTENT SCRIPT ================
if (isContent) {
  // Сканирование расписания текущей недели
  async function scanCurrentWeek() {
    const schedule = [];
    log('content', 'Начало сканирования расписания.');
    const rows = Array.from(
      document.querySelectorAll('.swiper-slide-active .fc-list-table tr')
    );
    let headingRow = rows.find((row) =>
      row.classList.contains('fc-list-heading')
    );
    let currentDate = '';
    let currentDay = '';
    if (headingRow) {
      currentDate = headingRow.getAttribute('data-date') || '';
      currentDay =
        headingRow.querySelector('.fc-list-heading-main')?.textContent.trim() ||
        '';
    } else {
      const today = new Date();
      currentDate = today.toISOString().slice(0, 10);
      currentDay = today.toLocaleDateString();
      console.warn(
        'content',
        `fc-list-heading не найден, используется дата: ${currentDate}`
      );
    }
    rows.forEach((row) => {
      if (row.classList.contains('fc-list-heading')) {
        const headingDate = row.getAttribute('data-date');
        if (headingDate && isHeadingDateValid(headingDate)) {
          currentDate = headingDate;
          currentDay =
            row.querySelector('.fc-list-heading-main')?.textContent.trim() ||
            currentDay;
        }
      } else if (row.classList.contains('fc-list-item')) {
        const timeElem = row.querySelector('.fc-list-item-time');
        const titleElem = row.querySelector('.fc-list-item-title a');
        const checkBtn = row.querySelector('.btn-success');
        if (timeElem && titleElem) {
          const times = timeElem.textContent.split(' - ');
          if (times.length < 2) return;
          const [start, finish] = times;
          const eventStart = new Date(`${currentDate}T${start.trim()}:00`);
          const now = new Date();
          const inlineColor = row.style.backgroundColor;
          const computed = window.getComputedStyle(row);
          const bgColor = inlineColor || computed?.backgroundColor || '';
          if (eventStart > now) {
            if (
              bgColor.includes('0, 123, 255') ||
              bgColor.includes('40, 167, 69')
            ) {
              const status = bgColor.includes('40, 167, 69')
                ? 'success'
                : 'waiting';
              schedule.push({
                day: currentDay,
                date: currentDate,
                start: start.trim(),
                finish: finish.trim(),
                name: titleElem.textContent.trim(),
                color: bgColor,
                isAvailable: checkBtn ? !checkBtn.disabled : false,
                status,
              });
            } else if (
              bgColor.includes('220, 53, 69') &&
              eventStart - now < 648000000
            ) {
              schedule.push({
                day: currentDay,
                date: currentDate,
                start: start.trim(),
                finish: finish.trim(),
                name: titleElem.textContent.trim(),
                color: bgColor,
                isAvailable: checkBtn ? !checkBtn.disabled : false,
                status: 'waiting',
              });
            }
          }
        }
      }
    });
    log(
      'content',
      `Сканирование завершено. Найдено событий: ${schedule.length}`
    );
    return schedule;
  }

  function isHeadingDateValid(dateStr) {
    const d = new Date(dateStr);
    const today = new Date();
    if (d.getFullYear() < today.getFullYear()) return false;
    if (d.getFullYear() === today.getFullYear()) {
      if (d.getMonth() < today.getMonth()) return false;
      if (d.getMonth() === today.getMonth() && d.getDate() < today.getDate())
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
      console.error('content', 'Ошибка получения состояния недели:', error);
      return 'this';
    }
  }

  async function setCurrentWeekStateAsync(state) {
    try {
      await setStorage({ currentWeekState: state });
      log('content', 'Состояние недели сохранено:', state);
    } catch (error) {
      console.error('content', 'Ошибка сохранения состояния недели:', error);
    }
  }

  async function navigateToWeek(targetWeek) {
    log('content', 'Навигация к неделе:', targetWeek);
    let prevDate = '';
    const heading = document.querySelector('.fc-list-heading');
    if (heading) prevDate = heading.getAttribute('data-date');
    const currentWeekState = await getCurrentWeekStateAsync();
    window.currentWeekState = currentWeekState;
    if (window.currentWeekState === targetWeek) {
      const schedule = await scanCurrentWeek();
      log('content', 'Неделя уже актуальна. Расписание:', schedule);
      chrome.runtime.sendMessage(
        { action: 'updateSchedule', schedule },
        (response) => {
          log('content', 'Ответ updateSchedule после навигации:', response);
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
                'addToWaitingList после навигации, ответ:',
                response
              );
            }
          );
        });
      return;
    }

    if (targetWeek === 'next' && window.currentWeekState === 'this') {
      const nextBtn = document.querySelector('.fc-next-button');
      if (nextBtn) {
        log('content', 'Нажимаем кнопку "Следующая неделя".');
        nextBtn.click();
        window.currentWeekState = 'next';
      } else {
        console.error('content', 'Кнопка "Следующая неделя" не найдена.');
      }
    } else if (targetWeek === 'this' && window.currentWeekState === 'next') {
      const todayBtn = document.querySelector('.fc-today-button');
      if (todayBtn) {
        log('content', 'Нажимаем кнопку "Сегодня".');
        todayBtn.click();
        window.currentWeekState = 'this';
      } else {
        console.error('content', 'Кнопка "Сегодня" не найдена.');
      }
    }

    await setCurrentWeekStateAsync(window.currentWeekState);
    await delay(1000);
    const schedule = await scanCurrentWeek();
    log('content', 'Сканирование после навигации, расписание:', schedule);
    chrome.runtime.sendMessage(
      { action: 'updateSchedule', schedule },
      (response) => {
        log('content', 'Ответ updateSchedule после навигации:', response);
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
              'addToWaitingList после навигации, ответ:',
              response
            );
          }
        );
      });
  }

  async function scheduleBooking(slot) {
    log('content', 'Планирование бронирования для слота:', slot);
    const eventStart = new Date(`${slot.date}T${slot.start}:00`);
    const bookingOffset = 7 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000;
    const targetBookingTime = new Date(eventStart.getTime() - bookingOffset);
    log('content', 'Время открытия записи:', targetBookingTime);
    const check = () => {
      const now = new Date();
      if (now >= targetBookingTime) {
        log('content', 'Время наступило. Пытаемся забронировать слот:', slot);
        const rows = Array.from(
          document.querySelectorAll('.swiper-slide-active .fc-list-table tr')
        );
        let currentDate = '';
        let targetRow = null;
        for (const row of rows) {
          if (row.classList.contains('fc-list-heading')) {
            currentDate = row.getAttribute('data-date') || '';
            continue;
          }
          if (row.classList.contains('fc-list-item')) {
            const titleElem = row.querySelector('.fc-list-item-title a');
            const timeElem = row.querySelector('.fc-list-item-time');
            if (!titleElem || !timeElem) continue;
            const times = timeElem.textContent.split(' - ');
            if (
              currentDate === slot.date &&
              titleElem.textContent.includes(slot.name) &&
              times[0].trim() === slot.start
            ) {
              targetRow = row;
              break;
            }
          }
        }
        if (targetRow) {
          targetRow.click();
          setTimeout(() => {
            const successBtn = document.querySelector(
              '#group-info-modal .modal-footer .btn-success'
            );
            if (successBtn && !successBtn.disabled) {
              successBtn.click();
              log('content', 'Запись успешна для слота:', slot);
              chrome.runtime.sendMessage({
                action: 'updateWaitingListStatus',
                slot: { ...slot, status: 'success' },
              });
            } else {
              console.error(
                'content',
                'Кнопка подтверждения недоступна для слота:',
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
            'content',
            'Строка для записи не найдена для слота:',
            slot
          );
          chrome.runtime.sendMessage({
            action: 'updateWaitingListStatus',
            slot: { ...slot, status: 'failed' },
          });
        }
      } else {
        const timeLeft = targetBookingTime - now;
        log(
          'content',
          `До записи для "${slot.name}" осталось ${timeLeft} мс. Проверка через 1 сек.`
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
      log('content', 'Результат сканирования:', schedule);
      chrome.runtime.sendMessage(
        { action: 'updateSchedule', schedule },
        (response) => {
          log('content', 'Ответ updateSchedule:', response);
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
                'addToWaitingList для активной записи, ответ:',
                response
              );
            }
          );
        });
    } catch (error) {
      console.error('content', 'Ошибка в initAfterDelay:', error);
    }
  }

  window.addEventListener('load', initAfterDelay);

  // Обработка кликов по кнопкам смены недели
  document.addEventListener('click', (event) => {
    const btn = event.target.closest(
      '.fc-prev-button, .fc-next-button, .fc-today-button'
    );
    if (btn) {
      log('content', 'Кнопка смены недели нажата, сканирование запускается.');
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
            log(
              'content',
              'Ответ updateSchedule после смены недели:',
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
                log(
                  'content',
                  'addToWaitingList после смены недели, ответ:',
                  response
                );
              }
            );
          });
      });
    }
  });

  // Обработка входящих сообщений
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
}
