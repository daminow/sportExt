(function () {
  var log = MyUtils.log,
    getStorage = MyUtils.getStorage,
    setStorage = MyUtils.setStorage;

  function createElement(tag, text, classList, attrs) {
    var element = document.createElement(tag);
    if (classList && classList.length) {
      classList.forEach(function (cls) {
        element.classList.add(cls);
      });
    }
    if (text) {
      element.textContent = text;
    }
    if (attrs) {
      for (var key in attrs) {
        element[key] = attrs[key];
      }
    }
    return element;
  }

  function useLoading(show) {
    var loadingIndicator = document.querySelector('.loader__box');
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
    setStorage({ popupState: state }, function (err) {
      if (err) {
        log('popup', 'Ошибка сохранения состояния:', err);
      } else {
        log('popup', 'Состояние сохранено:', state);
      }
    });
  }

  function restorePopupState(callback) {
    getStorage('popupState', function (err, data) {
      if (err) {
        log('popup', 'Ошибка восстановления состояния:', err);
      } else {
        log('popup', 'Восстановлено состояние:', data.popupState);
        callback && callback(data.popupState);
      }
    });
  }

  var scheduleData = [];
  var selectedWeek = 'this';
  var selectedSort = 'sport';
  var selectedOption = null;
  var loadRetries = 0;
  var maxRetries = 20;

  function loadSchedule() {
    getStorage(['schedule', 'scanningComplete'], function (err, data) {
      scheduleData = (data && data.schedule) || [];
      log('popup', 'Загружено расписание:', scheduleData);
      if (!data || !data.scanningComplete) {
        log(
          'popup',
          'Сканирование не завершено. Ожидание... (retry ' + loadRetries + ')'
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
    });
  }

  function updateSelects() {
    useLoading(true);
    var container = document.querySelector('.book__box');
    container.innerHTML = '';
    var mainSelect = createElement('select', '', ['book__select']);
    container.appendChild(mainSelect);
    if (selectedSort === 'sport') {
      mainSelect.appendChild(
        createElement('option', 'Select sport', ['book__select-item'], {
          disabled: true,
          selected: true,
        })
      );
      var sports = [];
      scheduleData.forEach(function (ev) {
        if (sports.indexOf(ev.name) === -1) {
          sports.push(ev.name);
        }
      });
      log('popup', 'Доступные виды спорта:', sports);
      sports.forEach(function (sport) {
        var option = createElement('option', sport, ['book__select-item'], {
          value: sport,
        });
        mainSelect.appendChild(option);
      });
    } else {
      mainSelect.appendChild(
        createElement('option', 'Select day', ['book__select-item'], {
          disabled: true,
          selected: true,
        })
      );
      var days = [];
      scheduleData.forEach(function (ev) {
        if (days.indexOf(ev.day) === -1) {
          days.push(ev.day);
        }
      });
      log('popup', 'Доступные дни:', days);
      days.forEach(function (day) {
        var option = createElement('option', day, ['book__select-item'], {
          value: day,
        });
        mainSelect.appendChild(option);
      });
    }
    sortSelectChange(mainSelect);
    useLoading(false);
  }

  function sortSelectChange(mainSelect) {
    var oldBtn = document.querySelector('.book__btn');
    if (oldBtn) oldBtn.parentNode.removeChild(oldBtn);
    mainSelect.addEventListener('change', function () {
      useLoading(true);
      selectedOption = mainSelect.value;
      log('popup', 'Изменён основной select:', selectedOption);
      updateAndSaveState();
      var oldSecondSelect = document.querySelector('.select-2');
      if (oldSecondSelect)
        oldSecondSelect.parentNode.removeChild(oldSecondSelect);
      var container = document.querySelector('.book__box');
      var filtered = [];
      var placeholder = 'Select time';
      if (selectedSort === 'sport') {
        filtered = scheduleData.filter(function (ev) {
          return ev.name === selectedOption;
        });
      } else {
        filtered = scheduleData.filter(function (ev) {
          return ev.day === selectedOption;
        });
      }
      var secondSelect = createElement('select', '', [
        'book__select',
        'select-2',
      ]);
      container.appendChild(secondSelect);
      secondSelect.appendChild(
        createElement('option', placeholder, ['book__select-item'], {
          disabled: true,
          selected: true,
        })
      );
      filtered.forEach(function (ev) {
        var text =
          selectedSort === 'sport'
            ? ev.day + ' | ' + ev.start + ' - ' + ev.finish
            : ev.start + ' - ' + ev.finish + ' | ' + ev.name;
        secondSelect.appendChild(
          createElement('option', text, ['book__select-item'], {
            value: JSON.stringify(ev),
          })
        );
      });
      secondSelect.addEventListener('change', function () {
        changeLastSelect(mainSelect, secondSelect);
      });
      useLoading(false);
    });
  }

  function updateAndSaveState() {
    var state = { selectedWeek: selectedWeek, selectedSort: selectedSort };
    log('popup', 'Обновление состояния:', state);
    savePopupState(state);
  }

  function changeLastSelect(mainSelect, secondSelect) {
    var oldBtn = document.querySelector('.book__btn');
    if (oldBtn) oldBtn.parentNode.removeChild(oldBtn);
    var container = document.querySelector('.book__box');
    var bookBtn = createElement('button', 'Create booking', [
      'btn-reset',
      'book__btn',
    ]);
    container.appendChild(bookBtn);
    bookBtn.style.display = 'block';
    bookBtn.style.opacity = '1';
    bookBtn.addEventListener('click', function () {
      var value1 = mainSelect.value;
      var value2 = secondSelect.value;
      log('popup', 'Нажата кнопка бронирования:', value1, value2);
      updateAndSaveState();
      book(value1, value2);
    });
  }

  function book(value1, value2) {
    if (!value1 || !value2) return;
    var selectedEvent = JSON.parse(value2);
    selectedEvent.week = selectedWeek;
    log('popup', 'Событие для бронирования:', selectedEvent);
    useLoading(true);
    chrome.runtime.sendMessage(
      { action: 'addToWaitingList', slot: selectedEvent },
      function (response) {
        log('popup', 'Ответ addToWaitingList:', response);
        useLoading(false);
        updateWaitingList();
        chrome.runtime.sendMessage(
          { action: 'scheduleBooking', slot: selectedEvent },
          function (resp) {
            log('popup', 'Запуск scheduleBooking, ответ:', resp);
          }
        );
      }
    );
  }

  function updateWaitingList() {
    getStorage('waitingList', function (err, data) {
      log('popup', 'Обновление waiting list:', data && data.waitingList);
      var waitingListContainer = document.querySelector('.waiting__list');
      if (!waitingListContainer) {
        log('popup', 'Контейнер waiting list не найден.');
        return;
      }
      waitingListContainer.innerHTML = '';
      var waitingLists = (data && data.waitingList) || {};
      log('popup', 'Выбранная неделя:', selectedWeek);
      var currentList = waitingLists[selectedWeek] || [];
      if (currentList.length > 0) {
        var header = createElement('h4', 'Week: ' + selectedWeek, [
          'waiting-header',
        ]);
        waitingListContainer.appendChild(header);
        currentList.forEach(function (slot) {
          var li = createElement(
            'li',
            slot.start +
              ' - ' +
              slot.finish +
              ' | ' +
              slot.name +
              ' (' +
              slot.day +
              ') [' +
              slot.status +
              ']',
            []
          );
          if (slot.status === 'success')
            li.style.backgroundColor = 'lightgreen';
          else if (slot.status === 'failed')
            li.style.backgroundColor = 'lightcoral';
          else li.style.backgroundColor = 'lightyellow';
          var deleteBtn = createElement('span', '✖', ['delete-btn']);
          deleteBtn.addEventListener('click', function () {
            log('popup', 'Удаление элемента:', slot);
            removeWaitingItem(slot);
          });
          li.appendChild(deleteBtn);
          waitingListContainer.appendChild(li);
        });
      } else {
        waitingListContainer.innerHTML =
          '<p>No entries for week "' + selectedWeek + '"</p>';
      }
    });
  }

  function removeWaitingItem(slotToRemove) {
    getStorage('waitingList', function (err, data) {
      var waitingLists = (data && data.waitingList) || {};
      var identifier =
        slotToRemove.name + slotToRemove.date + slotToRemove.start;
      for (var week in waitingLists) {
        waitingLists[week] = waitingLists[week].filter(function (slot) {
          return slot.name + slot.date + slot.start !== identifier;
        });
      }
      setStorage({ waitingList: waitingLists }, function () {
        log('popup', 'Элемент удалён:', slotToRemove);
        updateWaitingList();
      });
    });
  }

  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName === 'local' && changes.waitingList) {
      log('popup', 'waiting list обновлён.');
      updateWaitingList();
    }
  });

  function initUI() {
    useLoading(true);
    log('popup', 'Инициализация UI popup...');
    restorePopupState(function (popupState) {
      if (popupState) {
        selectedWeek = popupState.selectedWeek || selectedWeek;
        selectedSort = popupState.selectedSort || selectedSort;
      }
      var weekRadios = document.querySelectorAll('input[name="week-type"]');
      var sortRadios = document.querySelectorAll('input[name="sort-type"]');
      weekRadios.forEach(function (radio) {
        radio.checked = radio.value === selectedWeek;
      });
      sortRadios.forEach(function (radio) {
        var label = radio.nextElementSibling
          ? radio.nextElementSibling.textContent.trim().toLowerCase()
          : '';
        radio.checked = label === selectedSort;
      });
      updateAndSaveState();
      loadSchedule();
      updateWaitingList();
      useLoading(false);
      sortRadios.forEach(function (radio) {
        radio.addEventListener('change', function () {
          useLoading(true);
          selectedSort =
            radio.nextElementSibling &&
            radio.nextElementSibling.textContent.trim().toLowerCase() === 'day'
              ? 'day'
              : 'sport';
          log('popup', 'Изменён тип сортировки:', selectedSort);
          selectedOption = null;
          updateAndSaveState();
          loadSchedule();
        });
      });
      weekRadios.forEach(function (radio) {
        radio.addEventListener('change', function () {
          useLoading(true);
          selectedWeek = radio.value;
          log('popup', 'Изменена неделя:', selectedWeek);
          updateAndSaveState();
          selectedOption = null;
          chrome.runtime.sendMessage(
            { action: 'navigateWeek', week: selectedWeek },
            function (response) {
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
      chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName === 'local' && changes.schedule) {
          log('popup', 'Расписание обновлено.');
          loadSchedule();
        }
      });
    });
  }

  window.addEventListener('load', function () {
    useLoading(true);
    log('popup', 'Инициализация popup UI...');
    initUI();
  });
})();
