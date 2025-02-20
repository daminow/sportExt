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

// Промисификация chrome.tabs.query
const queryTabs = (query) =>
  new Promise((resolve, reject) => {
    chrome.tabs.query(query, (tabs) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(tabs);
    });
  });

// Определяем, в каком контексте находимся
const isBackground = typeof document === 'undefined';
const isPopup =
  typeof document !== 'undefined' && location.protocol === 'chrome-extension:';
const isContent =
  typeof document !== 'undefined' && location.protocol.startsWith('http');

// ============ BACKGROUND (service worker) ================
if (isBackground) {
  // Функция бронирования – будет выполняться в контексте страницы через executeScript
  function bookSport(slot) {
    const rows = Array.from(
      document.querySelectorAll('.swiper-slide-active .fc-list-table tr')
    );
    let currentDate = '';
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
          const checkInButton = document.querySelector(
            '.modal-content .btn-success'
          );
          if (checkInButton) {
            checkInButton.click();
          }
          return;
        }
      }
    }
  }

  // Функции работы с waiting list
  async function addToWaitingList(slot) {
    if (slot.status !== 'success') slot.status = 'waiting';
    if (!slot.week) {
      const { currentWeekState = 'this' } = await getStorage({
        currentWeekState: 'this',
      });
      slot.week = currentWeekState;
    }
    await processAddToWaitingList(slot);
  }

  async function processAddToWaitingList(slot) {
    const data = await getStorage('waitingList');
    const waitingListObj = data.waitingList || {};
    const weekList = waitingListObj[slot.week] || [];
    const identifier = slot.name + slot.date + slot.start;
    if (
      !weekList.some(
        (item) => item.name + item.date + item.start === identifier
      )
    ) {
      weekList.unshift(slot);
      waitingListObj[slot.week] = weekList;
      await setStorage({ waitingList: waitingListObj });
      showNotification(
        slot.status === 'success'
          ? 'Запись подтверждена'
          : 'Добавлено в лист ожидания',
        `${slot.name} (${slot.day})`,
        'info'
      );
    } else {
      showNotification(
        'Уже в листе ожидания',
        `${slot.name} (${slot.day})`,
        'info'
      );
    }
  }

  function showNotification(title, message, type) {
    chrome.notifications.create('', {
      type: 'basic',
      iconUrl: 'icon.png',
      title,
      message,
      priority: type === 'error' ? 2 : 0,
    });
  }

  // Открытие попапа при загрузке нужной вкладки
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (
      changeInfo.status === 'complete' &&
      tab?.url &&
      tab.url.startsWith('https://sport.innopolis.university/profile/')
    ) {
      chrome.action.openPopup();
    }
  });

  // Единый обработчик сообщений
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        // Обработка сообщений, не требующих доступа к вкладке
        switch (message.action) {
          case 'updateSchedule': {
            await setStorage({
              schedule: message.schedule,
              lastUpdated: Date.now(),
              scanningComplete: true,
            });
            return sendResponse({ success: true });
          }
          case 'updateWaitingList': {
            return sendResponse({ success: true });
          }
          case 'openPopup': {
            chrome.action.openPopup();
            return sendResponse({ success: true });
          }
          case 'updateWaitingListStatus': {
            const data = await getStorage('waitingList');
            const waitingLists = data.waitingList || {};
            const identifier =
              message.slot.name + message.slot.date + message.slot.start;
            for (const week in waitingLists) {
              waitingLists[week] = waitingLists[week].map((slot) => {
                if (slot.name + slot.date + slot.start === identifier) {
                  return { ...slot, status: message.slot.status };
                }
                return slot;
              });
            }
            await setStorage({ waitingList: waitingLists });
            return sendResponse({ success: true });
          }
          default:
            break;
        }

        // Для сообщений, требующих взаимодействия с вкладкой
        const tabs = await queryTabs({
          url: 'https://sport.innopolis.university/profile/*',
        });
        if (!tabs || tabs.length === 0) {
          console.warn('background', 'Нет вкладок с нужным URL.');
          return sendResponse({ error: 'Нет вкладок с нужным URL' });
        }
        const tab = tabs[0];

        switch (message.action) {
          case 'scanSchedule': {
            chrome.tabs.sendMessage(
              tab.id,
              { action: 'scanSchedule', week: message.week },
              () => sendResponse({ success: true })
            );
            break;
          }
          case 'navigateWeek': {
            chrome.tabs.sendMessage(
              tab.id,
              { action: 'navigateWeek', week: message.week },
              () => sendResponse({ success: true })
            );
            break;
          }
          case 'bookSport': {
            // Запускаем функцию bookSport в контексте вкладки
            chrome.scripting
              .executeScript({
                target: { tabId: tab.id },
                func: bookSport,
                args: [message.slot],
              })
              .then(() => sendResponse({ success: true }))
              .catch((err) => sendResponse({ error: err.message }));
            break;
          }
          case 'addToWaitingList': {
            await addToWaitingList(message.slot);
            sendResponse({ success: true });
            break;
          }
          case 'scheduleBooking': {
            chrome.tabs.sendMessage(
              tab.id,
              { action: 'scheduleBooking', slot: message.slot },
              () => sendResponse({ success: true })
            );
            break;
          }
          default: {
            console.warn('background', 'Неизвестное действие:', message.action);
            sendResponse({
              warning: 'Неизвестное действие: ' + message.action,
            });
          }
        }
      } catch (error) {
        sendResponse({ error: error.message });
      }
    })();
    return true; // Асинхронный ответ
  });

  // Обработка alarm для проверки waiting list
  chrome.alarms.onAlarm.addListener(async () => {
    try {
      const data = await getStorage('waitingList');
      const waitingLists = data.waitingList || {};
      const now = new Date();
      let nextCheckTime = Infinity;

      for (const week in waitingLists) {
        const list = waitingLists[week];
        if (Array.isArray(list) && list.length > 0) {
          const slot = list[0];
          if (slot.status === 'success') {
            list.shift();
            waitingLists[week] = list;
            continue;
          }
          // Определяем смещение времени для бронирования по цвету
          let bookingOffset;
          if (slot.color && slot.color.includes('0, 123, 255')) {
            bookingOffset = 7 * 24 * 60 * 60 * 1000;
          } else if (
            slot.color &&
            (slot.color.includes('red') ||
              slot.color.includes('rgb(255, 0, 0)'))
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

          if (timeLeft <= 0) {
            // Если окно бронирования открыто – отправляем сообщение контент-скрипту
            const tabs = await queryTabs({
              url: 'https://sport.innopolis.university/profile/*',
            });
            if (tabs.length > 0) {
              chrome.tabs.sendMessage(tabs[0].id, {
                action: 'scheduleBooking',
                slot,
              });
            } else {
              console.warn(
                'background',
                'Alarm: Нет активных вкладок с нужным URL.'
              );
            }
            list.shift();
            waitingLists[week] = list;
          } else {
            if (timeLeft < nextCheckTime) nextCheckTime = timeLeft;
          }
        }
      }
      await setStorage({ waitingList: waitingLists });
      // При необходимости можно перенастроить alarm на nextCheckTime
    } catch (error) {
      console.error('[background] Ошибка в alarm:', error);
    }
  });
}

// ============ POPUP ================
if (isPopup) {
  window.addEventListener('load', () => {});
  window.addEventListener('unload', () => {});
  const createdLink = document.querySelector('.created');
  if (createdLink) {
    createdLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: createdLink.href });
    });
  }
  function createElement(tag = 'div', text = '', classList = [], attrs = {}) {
    const element = document.createElement(tag);
    if (classList.length) element.classList.add(...classList);
    // Используем textContent для безопасности, если требуется HTML – можно заменить на innerHTML
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
    } else {
      loader.style.opacity = '0';
      loader.style.display = 'none';
    }
  }

  function savePopupState(state) {
    setStorage({ popupState: state }).catch((error) =>
      console.error(
        `[${getCurrentDateTime()}] [popup] Ошибка сохранения:`,
        error
      )
    );
  }

  async function restorePopupState() {
    try {
      const data = await getStorage('popupState');
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
      if (!data.scanningComplete) {
        loadRetries++;
        if (loadRetries < maxRetries) {
          await delay(500);
          return loadSchedule();
        } else {
          console.warn('popup', 'Превышено число попыток ожидания.');
        }
      }
      updateSelects();
      useLoading(false);
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
      const sports = [
        ...new Set(
          scheduleData
            .filter((ev) => ev.status !== 'success')
            .map((ev) => ev.name)
        ),
      ];
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
      updateAndSaveState();

      const oldSecondSelect = document.querySelector('.select-2');
      if (oldSecondSelect) oldSecondSelect.remove();

      const container = document.querySelector('.book__box');
      const filtered =
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
        if (ev.status !== 'success') {
          const text =
            selectedSort === 'sport'
              ? `${ev.day} | ${ev.start} - ${ev.finish}`
              : `${ev.start} - ${ev.finish} | ${ev.name}`;
          secondSelect.append(
            createElement('option', text, ['book__select-item'], {
              value: JSON.stringify(ev),
            })
          );
        }
      });
      secondSelect.addEventListener('change', () =>
        changeLastSelect(mainSelect, secondSelect)
      );
      useLoading(false);
    });
  }

  function updateAndSaveState() {
    const state = { selectedWeek, selectedSort };
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
      updateAndSaveState();
      const slot = JSON.parse(secondSelect.value);
      // Добавление в waiting list
      chrome.runtime.sendMessage(
        { action: 'addToWaitingList', slot },
        (response) => {
          useLoading(false);
          updateWaitingList();
          // Запуск планирования записи
          chrome.runtime.sendMessage({ action: 'scheduleBooking', slot });
        }
      );
    });
  }

  function updateWaitingList() {
    chrome.storage.local.get('waitingList', (data) => {
      const container = document.querySelector('.waiting__list');
      if (!container) {
        console.error('popup', 'Контейнер waiting list не найден.');
        return;
      }
      container.innerHTML = '';
      const waitingLists = data.waitingList || {};
      const currentList = waitingLists[selectedWeek] || [];
      if (currentList.length > 0) {
        const header = createElement('h4', `Week: ${selectedWeek}`, [
          'waiting__header',
        ]);
        container.appendChild(header);
        currentList.forEach((slot) => {
          const li = createElement(
            'li',
            `${slot.day} | ${slot.start} - ${slot.finish}<br>${slot.name}`,
            ['waiting__item']
          );
          li.style.backgroundColor =
            slot.status === 'success'
              ? 'lightgreen'
              : slot.status === 'failed'
              ? 'lightcoral'
              : 'lightyellow';
          const delBtn = createElement('button', '✖', [
            'btn-reset',
            'waiting__item-delete-btn',
          ]);
          delBtn.addEventListener('click', () => removeWaitingItem(slot));
          li.appendChild(delBtn);
          container.appendChild(li);
        });
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
        updateWaitingList();
      });
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes.waitingList) updateWaitingList();
      if (changes.schedule) loadSchedule();
    }
  });

  async function initUI() {
    useLoading(true);
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
    await loadSchedule();
    updateWaitingList();
    useLoading(false);

    sortRadios.forEach((radio) => {
      radio.addEventListener('change', async () => {
        useLoading(true);
        selectedSort =
          radio.nextElementSibling.textContent.trim().toLowerCase() === 'day'
            ? 'day'
            : 'sport';
        selectedOption = null;
        updateAndSaveState();
        await loadSchedule();
      });
    });

    weekRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        useLoading(true);
        selectedWeek = radio.value;
        updateAndSaveState();
        chrome.runtime.sendMessage(
          { action: 'navigateWeek', week: selectedWeek },
          (response) => {
            if (chrome.runtime.lastError)
              console.error(
                'popup',
                'Ошибка navigateWeek:',
                chrome.runtime.lastError.message
              );
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
    initUI();
  });
}

// ============ CONTENT SCRIPT ================
if (isContent) {
  // Вспомогательная функция ожидания элемента (до timeout мс)
  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const interval = setInterval(() => {
        const element = document.querySelector(selector);
        if (element) {
          clearInterval(interval);
          resolve(element);
        } else if (Date.now() - startTime > timeout) {
          clearInterval(interval);
          reject(new Error('Элемент не найден: ' + selector));
        }
      }, 100);
    });
  }

  // Сканирование расписания текущей недели
  async function scanCurrentWeek() {
    const schedule = [];
    const rows = Array.from(
      document.querySelectorAll('.swiper-slide-active .fc-list-table tr')
    );
    // Определяем текущую дату и день из первого heading-элемента
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
          const sevenDaysInMillis = 7 * 24 * 60 * 60 * 1000 - 1000;
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
              eventStart - now < 648000000 &&
              eventStart - now > sevenDaysInMillis
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
      return data.currentWeekState;
    } catch (error) {
      console.error('content', 'Ошибка получения состояния недели:', error);
      return 'this';
    }
  }

  async function setCurrentWeekStateAsync(state) {
    try {
      await setStorage({ currentWeekState: state });
    } catch (error) {
      console.error('content', 'Ошибка сохранения состояния недели:', error);
    }
  }

  // Функция навигации по неделям с ожиданием появления кнопок
  async function navigateToWeek(targetWeek) {
    const heading = document.querySelector('.fc-list-heading');
    const prevDate = heading ? heading.getAttribute('data-date') : '';
    const currentWeekState = await getCurrentWeekStateAsync();
    window.currentWeekState = currentWeekState;
    if (window.currentWeekState === targetWeek) {
      const schedule = await scanCurrentWeek();
      chrome.runtime.sendMessage({ action: 'updateSchedule', schedule });
      schedule
        .filter((ev) => ev.status === 'success')
        .forEach((ev) =>
          chrome.runtime.sendMessage({ action: 'addToWaitingList', slot: ev })
        );
      return;
    }

    try {
      if (targetWeek === 'next' && window.currentWeekState === 'this') {
        const nextBtn = await waitForElement('.fc-next-button');
        nextBtn.click();
        window.currentWeekState = 'next';
      } else if (targetWeek === 'this' && window.currentWeekState === 'next') {
        const todayBtn = await waitForElement('.fc-today-button');
        todayBtn.click();
        window.currentWeekState = 'this';
      }
    } catch (error) {
      console.error('content', 'Ошибка навигации к неделе:', error);
    }

    await setCurrentWeekStateAsync(window.currentWeekState);
    await delay(1000);
    const schedule = await scanCurrentWeek();
    chrome.runtime.sendMessage({ action: 'updateSchedule', schedule });
    schedule
      .filter((ev) => ev.status === 'success')
      .forEach((ev) =>
        chrome.runtime.sendMessage({ action: 'addToWaitingList', slot: ev })
      );
  }

  // ===== Новый механизм проверки бронирования =====

  // Функция инициирует проверку записи, ожидая открытие окна бронирования (7 дней до события)
  function initiateBookingCheck(slot) {
    const eventStart = new Date(`${slot.date}T${slot.start}:00`);
    const bookingWindowTime = new Date(
      eventStart.getTime() - 7 * 24 * 60 * 60 * 1000
    );
    const now = new Date();
    const timeUntilWindow = bookingWindowTime - now;

    if (timeUntilWindow > 0) {
      setTimeout(() => checkBooking(slot), timeUntilWindow);
    } else {
      checkBooking(slot);
    }
  }

  // Функция проверки возможности записи с динамическим интервалом
  function checkBooking(slot) {
    const eventStart = new Date(`${slot.date}T${slot.start}:00`);
    const bookingWindowTime = new Date(
      eventStart.getTime() - 7 * 24 * 60 * 60 * 1000
    );
    const now = new Date();
    const remaining = bookingWindowTime - now;

    if (remaining <= 0) {
      attemptBooking(slot);
    } else {
      let interval;
      if (remaining > 126000) interval = 60000;
      else if (remaining > 40000) interval = 15000;
      else if (remaining > 15000) interval = 5000;
      else if (remaining > 5000) interval = 1000;
      else interval = 500;
      setTimeout(() => checkBooking(slot), interval);
    }
  }

  // Функция попытки бронирования слота
  function attemptBooking(slot) {
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
          chrome.runtime.sendMessage({
            action: 'updateWaitingListStatus',
            slot: { ...slot, status: 'success' },
          });
        } else {
          chrome.runtime.sendMessage({
            action: 'updateWaitingListStatus',
            slot: { ...slot, status: 'failed' },
          });
        }
      }, 500);
    } else {
      chrome.runtime.sendMessage({
        action: 'updateWaitingListStatus',
        slot: { ...slot, status: 'failed' },
      });
    }
  }

  // Обработка входящих сообщений от background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'navigateWeek') {
      navigateToWeek(message.week).then(() => sendResponse({ success: true }));
    } else if (message.action === 'scheduleBooking') {
      initiateBookingCheck(message.slot);
      sendResponse({ success: true });
    }
    return true;
  });

  // Инициализация после загрузки страницы
  async function initAfterDelay() {
    try {
      const data = await getStorage({ currentWeekState: 'this' });
      if (data.currentWeekState === 'next') {
        document.querySelector('.fc-next-button')?.click();
        await delay(2000);
      }
      const schedule = await scanCurrentWeek();
      chrome.runtime.sendMessage({ action: 'updateSchedule', schedule });
      schedule
        .filter((ev) => ev.status === 'success')
        .forEach((ev) =>
          chrome.runtime.sendMessage({ action: 'addToWaitingList', slot: ev })
        );
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
      delay(1500).then(async () => {
        const schedule = await scanCurrentWeek();
        chrome.runtime.sendMessage({ action: 'updateSchedule', schedule });
        schedule
          .filter((ev) => ev.status === 'success')
          .forEach((ev) =>
            chrome.runtime.sendMessage({ action: 'addToWaitingList', slot: ev })
          );
      });
    }
  });
}
