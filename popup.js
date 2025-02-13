// popup.js
import { getCurrentDateTime, getStorage, setStorage, log } from './utils.js';

window.addEventListener('load', () => {
  log('popup', 'Интерфейс расширения открыт.');
});
window.addEventListener('unload', () => {
  log('popup', 'Интерфейс расширения закрыт.');
});

function createElement(tag = 'div', text = '', classList = [], attrs = {}) {
  const element = document.createElement(tag);
  element.classList.add(...classList);
  element.textContent = text;
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
    log('popup', 'Loading ON');
  } else {
    loadingIndicator.style.opacity = '0';
    loadingIndicator.style.display = 'none';
    log('popup', 'Loading OFF');
  }
}

function savePopupState(state) {
  setStorage({ popupState: state })
    .then(() => {
      log('popup', 'Состояние сохранено:', state);
    })
    .catch((error) => {
      log('popup', 'Ошибка сохранения состояния:', error);
    });
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
    log('popup', 'Ошибка восстановления состояния:', error);
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
      log(
        'popup',
        `Сканирование не завершено. Ожидание... (retry ${loadRetries})`
      );
      loadRetries++;
      if (loadRetries < maxRetries) {
        setTimeout(loadSchedule, 500);
      } else {
        log('popup', 'Превышено число попыток ожидания сканирования.');
        updateSelects();
        useLoading(false);
      }
    } else {
      updateSelects();
      useLoading(false);
    }
  } catch (error) {
    log('popup', 'Ошибка загрузки расписания:', error);
    useLoading(false);
  }
}

function updateSelects() {
  useLoading(true);
  const container = document.querySelector('.book__box');
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
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
    log('popup', 'Изменён основной select:', selectedOption);
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
    const waitingListContainer = document.querySelector('.waiting__list');
    if (!waitingListContainer) {
      log('popup', 'Контейнер waiting list не найден.');
      return;
    }
    while (waitingListContainer.firstChild) {
      waitingListContainer.removeChild(waitingListContainer.firstChild);
    }
    const waitingLists = data.waitingList || {};
    log('popup', 'Выбранная неделя:', selectedWeek);
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
        if (slot.status === 'success') li.style.backgroundColor = 'lightgreen';
        else if (slot.status === 'failed')
          li.style.backgroundColor = 'lightcoral';
        else li.style.backgroundColor = 'lightyellow';
        const deleteBtn = createElement('span', '✖', ['delete-btn']);
        deleteBtn.addEventListener('click', () => {
          log('popup', 'Удаление элемента:', slot);
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
      log('popup', 'Изменён тип сортировки:', selectedSort);
      selectedOption = null;
      updateAndSaveState();
      loadSchedule();
    });
  });
  weekRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      useLoading(true);
      selectedWeek = radio.value;
      log('popup', 'Изменена неделя:', selectedWeek);
      updateAndSaveState();
      selectedOption = null;
      chrome.runtime.sendMessage(
        { action: 'navigateWeek', week: selectedWeek },
        (response) => {
          if (chrome.runtime.lastError)
            log(
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
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.schedule) {
      log('popup', 'Расписание обновлено.');
      loadSchedule();
    }
  });
}

window.addEventListener('load', () => {
  useLoading(true);
  log('popup', 'Инициализация popup UI...');
  initUI();
});
