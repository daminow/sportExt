// popup.js
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

  window.addEventListener('load', () => {
    console.log(
      `[${getCurrentDateTime()}] [popup] Интерфейс расширения открыт.`
    );
  });
  window.addEventListener('unload', () => {
    console.log(
      `[${getCurrentDateTime()}] [popup] Интерфейс расширения закрыт.`
    );
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
    const loadingIndicator = document.querySelector('.loader__box');
    if (!loadingIndicator) return;
    if (show) {
      loadingIndicator.style.display = 'flex';
      loadingIndicator.style.opacity = '1';
      console.log(`[${getCurrentDateTime()}] [popup] Loading ON`);
    } else {
      loadingIndicator.style.opacity = '0';
      loadingIndicator.style.display = 'none';
      console.log(`[${getCurrentDateTime()}] [popup] Loading OFF`);
    }
  }

  function savePopupState(state) {
    setStorage({ popupState: state })
      .then(() => {
        console.log(
          `[${getCurrentDateTime()}] [popup] Состояние сохранено:`,
          state
        );
      })
      .catch((error) => {
        console.error(
          `[${getCurrentDateTime()}] [popup] Ошибка сохранения состояния:`,
          error
        );
      });
  }

  async function restorePopupState() {
    try {
      const data = await getStorage('popupState');
      console.log(
        `[${getCurrentDateTime()}] [popup] Восстановлено состояние:`,
        data.popupState
      );
      if (data.popupState) {
        selectedWeek = data.popupState.selectedWeek || selectedWeek;
        selectedSort = data.popupState.selectedSort || selectedSort;
      }
    } catch (error) {
      console.error(
        `[${getCurrentDateTime()}] [popup] Ошибка восстановления состояния:`,
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
      console.log(
        `[${getCurrentDateTime()}] [popup] Загружено расписание:`,
        scheduleData
      );
      if (!data.scanningComplete) {
        console.log(
          `[${getCurrentDateTime()}] [popup] Сканирование не завершено. Ожидание... (retry ${loadRetries})`
        );
        loadRetries++;
        if (loadRetries < maxRetries) {
          setTimeout(loadSchedule, 500);
        } else {
          console.warn(
            `[${getCurrentDateTime()}] [popup] Превышено число попыток ожидания сканирования.`
          );
          updateSelects();
          useLoading(false);
        }
      } else {
        updateSelects();
        useLoading(false);
      }
    } catch (error) {
      console.error(
        `[${getCurrentDateTime()}] [popup] Ошибка загрузки расписания:`,
        error
      );
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
      console.log(
        `[${getCurrentDateTime()}] [popup] Доступные виды спорта:`,
        sports
      );
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
      console.log(`[${getCurrentDateTime()}] [popup] Доступные дни:`, days);
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
      console.log(
        `[${getCurrentDateTime()}] [popup] Изменён основной select:`,
        selectedOption
      );
      updateAndSaveState();

      const oldSecondSelect = document.querySelector('.select-2');
      if (oldSecondSelect) oldSecondSelect.remove();

      const container = document.querySelector('.book__box');
      let filtered = [];
      const placeholder = 'Select time';
      if (selectedSort === 'sport') {
        filtered = scheduleData.filter((ev) => ev.name === selectedOption);
      } else {
        filtered = scheduleData.filter((ev) => ev.day === selectedOption);
      }

      const secondSelect = createElement('select', '', [
        'book__select',
        'select-2',
      ]);
      container.append(secondSelect);
      secondSelect.append(
        createElement('option', placeholder, ['book__select-item'], {
          disabled: true,
          selected: true,
        })
      );

      if (selectedSort === 'sport') {
        filtered.forEach((ev) => {
          secondSelect.append(
            createElement(
              'option',
              `${ev.day} | ${ev.start} - ${ev.finish}`,
              ['book__select-item'],
              { value: JSON.stringify(ev) }
            )
          );
        });
      } else {
        filtered.forEach((ev) => {
          secondSelect.append(
            createElement(
              'option',
              `${ev.start} - ${ev.finish} | ${ev.name}`,
              ['book__select-item'],
              { value: JSON.stringify(ev) }
            )
          );
        });
      }
      secondSelect.addEventListener('change', () => {
        changeLastSelect(mainSelect, secondSelect);
      });
      useLoading(false);
    });
  }

  function updateAndSaveState() {
    const state = { selectedWeek, selectedSort };
    console.log(
      `[${getCurrentDateTime()}] [popup] Обновление состояния:`,
      state
    );
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
      console.log(
        `[${getCurrentDateTime()}] [popup] Нажата кнопка бронирования:`,
        value1,
        value2
      );
      updateAndSaveState();
      book(value1, value2);
    });
  }

  // Функция бронирования: после добавления бронирования запускается сканирование возможности записи
  function book(value1, value2) {
    if (!value1 || !value2) return;
    const selectedEvent = JSON.parse(value2);
    selectedEvent.week = selectedWeek;
    console.log(
      `[${getCurrentDateTime()}] [popup] Событие для бронирования:`,
      selectedEvent
    );
    useLoading(true);
    chrome.runtime.sendMessage(
      { action: 'addToWaitingList', slot: selectedEvent },
      (response) => {
        console.log(
          `[${getCurrentDateTime()}] [popup] Ответ addToWaitingList:`,
          response
        );
        useLoading(false);
        updateWaitingList();
        // После добавления бронирования запускается сканирование возможности записи
        chrome.runtime.sendMessage(
          { action: 'scheduleBooking', slot: selectedEvent },
          (resp) => {
            console.log(
              `[${getCurrentDateTime()}] [popup] Запуск scheduleBooking, ответ:`,
              resp
            );
          }
        );
      }
    );
  }

  function updateWaitingList() {
    chrome.storage.local.get('waitingList', (data) => {
      console.log(
        `[${getCurrentDateTime()}] [popup] Обновление waiting list:`,
        data.waitingList
      );
      const waitingListContainer = document.querySelector('.waiting__list');
      if (!waitingListContainer) {
        console.error(
          `[${getCurrentDateTime()}] [popup] Контейнер waiting list не найден.`
        );
        return;
      }
      waitingListContainer.innerHTML = '';
      const waitingLists = data.waitingList || {};
      console.log(
        `[${getCurrentDateTime()}] [popup] Выбранная неделя:`,
        selectedWeek
      );
      const currentList = waitingLists[selectedWeek] || [];
      if (currentList.length > 0) {
        const header = createElement('h4', `Week: ${selectedWeek}`, [
          'waiting-header',
        ]);
        waitingListContainer.appendChild(header);
        currentList.forEach((slot) => {
          const li = createElement('li');
          li.className = 'waiting-item';
          li.textContent = `${slot.start} - ${slot.finish} | ${slot.name} (${slot.day}) [${slot.status}]`;
          if (slot.status === 'success')
            li.style.backgroundColor = 'lightgreen';
          else if (slot.status === 'failed')
            li.style.backgroundColor = 'lightcoral';
          else li.style.backgroundColor = 'lightyellow';
          const deleteBtn = createElement('span', '✖', ['delete-btn']);
          deleteBtn.addEventListener('click', () => {
            console.log(
              `[${getCurrentDateTime()}] [popup] Удаление элемента:`,
              slot
            );
            removeWaitingItem(slot);
          });
          li.appendChild(deleteBtn);
          waitingListContainer.appendChild(li);
        });
      } else {
        waitingListContainer.innerHTML = `<p>No entries for week "${selectedWeek}"</p>`;
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
        console.log(
          `[${getCurrentDateTime()}] [popup] Элемент удалён:`,
          slotToRemove
        );
        updateWaitingList();
      });
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.waitingList) {
      console.log(`[${getCurrentDateTime()}] [popup] waiting list обновлён.`);
      updateWaitingList();
    }
  });

  async function initUI() {
    useLoading(true);
    console.log(`[${getCurrentDateTime()}] [popup] Инициализация UI popup...`);
    await restorePopupState();

    const weekRadios = document.querySelectorAll('input[name="week-type"]');
    const sortRadios = document.querySelectorAll('input[name="sort-type"]');

    weekRadios.forEach((radio) => {
      radio.checked = radio.value === selectedWeek;
    });
    sortRadios.forEach((radio) => {
      const label = radio.nextElementSibling.textContent.trim().toLowerCase();
      radio.checked = label === selectedSort;
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
        console.log(
          `[${getCurrentDateTime()}] [popup] Изменён тип сортировки:`,
          selectedSort
        );
        selectedOption = null;
        updateAndSaveState();
        loadSchedule();
      });
    });

    weekRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        useLoading(true);
        selectedWeek = radio.value;
        console.log(
          `[${getCurrentDateTime()}] [popup] Изменена неделя:`,
          selectedWeek
        );
        updateAndSaveState();
        selectedOption = null;
        chrome.runtime.sendMessage(
          { action: 'navigateWeek', week: selectedWeek },
          (response) => {
            if (chrome.runtime.lastError)
              console.error(
                `[${getCurrentDateTime()}] [popup] Ошибка navigateWeek:`,
                chrome.runtime.lastError.message
              );
            console.log(
              `[${getCurrentDateTime()}] [popup] Ответ navigateWeek:`,
              response
            );
            loadSchedule();
            updateWaitingList();
            useLoading(false);
          }
        );
      });
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.schedule) {
        console.log(`[${getCurrentDateTime()}] [popup] Расписание обновлено.`);
        loadSchedule();
      }
    });
  }

  window.addEventListener('load', () => {
    useLoading(true);
    console.log(`[${getCurrentDateTime()}] [popup] Инициализация popup UI...`);
    initUI();
  });
})();
