(function () {
  // Убедитесь, что utils.js загружен раньше content.js (см. манифест)
  if (!window.MyUtils) {
    console.error('MyUtils не определён в content.js!');
    return;
  }
  var log = MyUtils.log,
    getStorage = MyUtils.getStorage,
    setStorage = MyUtils.setStorage,
    WEEK_IN_MS = MyUtils.WEEK_IN_MS,
    HALF_DAY_IN_MS = MyUtils.HALF_DAY_IN_MS;

  function delay(ms, callback) {
    setTimeout(callback, ms);
  }

  function scanCurrentWeek() {
    var schedule = [];
    log('content', 'Начало сканирования расписания.');
    var tableRows = Array.prototype.slice.call(
      document.querySelectorAll('.swiper-slide-active .fc-list-table tr')
    );
    var headingRow = tableRows.find(function (row) {
      return row.classList.contains('fc-list-heading');
    });
    var currentHeadingDate = '';
    var currentDay = '';
    if (headingRow) {
      currentHeadingDate = headingRow.getAttribute('data-date') || '';
      currentDay = headingRow.querySelector('.fc-list-heading-main')
        ? headingRow.querySelector('.fc-list-heading-main').textContent.trim()
        : '';
    } else {
      var today = new Date();
      currentHeadingDate = today.toISOString().slice(0, 10);
      currentDay = today.toLocaleDateString();
      log(
        'content',
        'fc-list-heading не найден, используется дата по умолчанию: ' +
          currentHeadingDate
      );
    }
    tableRows.forEach(function (row) {
      if (row.classList.contains('fc-list-heading')) {
        var headingDate = row.getAttribute('data-date');
        if (headingDate && isHeadingDateValid(headingDate)) {
          currentHeadingDate = headingDate;
          currentDay = row.querySelector('.fc-list-heading-main')
            ? row.querySelector('.fc-list-heading-main').textContent.trim()
            : currentDay;
        }
      } else if (row.classList.contains('fc-list-item')) {
        var timeElem = row.querySelector('.fc-list-item-time');
        var titleElem = row.querySelector('.fc-list-item-title a');
        var checkInButton = row.querySelector('.btn-success');
        if (timeElem && titleElem) {
          var times = timeElem.textContent.split(' - ');
          if (times.length < 2) return;
          var start = times[0].trim(),
            finish = times[1].trim();
          var eventStart = new Date(currentHeadingDate + 'T' + start + ':00');
          var now = new Date();
          var inlineBgColor = row.style.backgroundColor;
          var computedStyle = window.getComputedStyle(row);
          var backgroundColor =
            inlineBgColor ||
            (computedStyle ? computedStyle.backgroundColor : '');
          if (eventStart > now) {
            if (
              backgroundColor.indexOf('0, 123, 255') !== -1 ||
              backgroundColor.indexOf('40, 167, 69') !== -1
            ) {
              var status =
                backgroundColor.indexOf('40, 167, 69') !== -1
                  ? 'success'
                  : 'waiting';
              schedule.push({
                day: currentDay,
                date: currentHeadingDate,
                start: start,
                finish: finish,
                name: titleElem.textContent.trim(),
                color: backgroundColor,
                isAvailable: checkInButton ? !checkInButton.disabled : false,
                status: status,
              });
            } else if (
              backgroundColor.indexOf('220, 53, 69') !== -1 &&
              eventStart - now < 648000000
            ) {
              schedule.push({
                day: currentDay,
                date: currentHeadingDate,
                start: start,
                finish: finish,
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
    log(
      'content',
      'Сканирование завершено. Найдено событий: ' + schedule.length
    );
    return schedule;
  }

  function isHeadingDateValid(dateStr) {
    var headingDate = new Date(dateStr);
    var today = new Date();
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

  function getCurrentWeekStateAsync(callback) {
    chrome.storage.local.get({ currentWeekState: 'this' }, function (data) {
      log('content', 'Текущее состояние недели:', data.currentWeekState);
      callback(data.currentWeekState);
    });
  }

  function setCurrentWeekStateAsync(state, callback) {
    chrome.storage.local.set({ currentWeekState: state }, function () {
      log('content', 'Сохранено состояние недели:', state);
      callback && callback();
    });
  }

  var currentWeekState = null;

  function navigateToWeek(targetWeek) {
    log('content', 'Навигация к неделе:', targetWeek);
    var headingRow = document.querySelector('.fc-list-heading');
    var previousDate = headingRow ? headingRow.getAttribute('data-date') : '';
    getCurrentWeekStateAsync(function (state) {
      currentWeekState = state;
      if (currentWeekState === targetWeek) {
        var schedule = scanCurrentWeek();
        log('content', 'Неделя уже соответствует. Расписание:', schedule);
        chrome.runtime.sendMessage({
          action: 'updateSchedule',
          schedule: schedule,
        });
        schedule
          .filter(function (ev) {
            return ev.status === 'success';
          })
          .forEach(function (ev) {
            chrome.runtime.sendMessage({
              action: 'addToWaitingList',
              slot: ev,
            });
          });
        return;
      }
      if (targetWeek === 'next' && currentWeekState === 'this') {
        var nextButton = document.querySelector('.fc-next-button');
        if (nextButton) {
          log('content', 'Нажимаем кнопку "Следующая неделя".');
          nextButton.click();
          currentWeekState = 'next';
        } else {
          log('content', 'Кнопка "Следующая неделя" не найдена.');
        }
      } else if (targetWeek === 'this' && currentWeekState === 'next') {
        var todayButton = document.querySelector('.fc-today-button');
        if (todayButton) {
          log('content', 'Нажимаем кнопку "Сегодня".');
          todayButton.click();
          currentWeekState = 'this';
        } else {
          log('content', 'Кнопка "Сегодня" не найдена.');
        }
      }
      setCurrentWeekStateAsync(currentWeekState, function () {
        delay(1000, function () {
          var schedule = scanCurrentWeek();
          log('content', 'Итог сканирования после навигации:', schedule);
          chrome.runtime.sendMessage({
            action: 'updateSchedule',
            schedule: schedule,
          });
          schedule
            .filter(function (ev) {
              return ev.status === 'success';
            })
            .forEach(function (ev) {
              chrome.runtime.sendMessage({
                action: 'addToWaitingList',
                slot: ev,
              });
            });
        });
      });
    });
  }

  function scheduleBooking(slot) {
    log('content', 'Планирование бронирования для слота:', slot);
    var eventStart = new Date(slot.date + 'T' + slot.start + ':00');
    var bookingOffset = WEEK_IN_MS + HALF_DAY_IN_MS;
    var targetBookingTime = new Date(eventStart.getTime() - bookingOffset);
    log('content', 'Время открытия записи рассчитано:', targetBookingTime);
    function check() {
      var now = new Date();
      if (now >= targetBookingTime) {
        log(
          'content',
          'Время открытия записи наступило. Пытаемся забронировать слот:',
          slot
        );
        var rows = Array.prototype.slice.call(
          document.querySelectorAll('.swiper-slide-active .fc-list-table tr')
        );
        var targetRow = rows.find(function (row) {
          var titleElem = row.querySelector('.fc-list-item-title a');
          return titleElem && titleElem.textContent.indexOf(slot.name) !== -1;
        });
        if (targetRow) {
          targetRow.click();
          setTimeout(function () {
            var successButton = document.querySelector(
              '#group-info-modal .modal-footer .btn-success'
            );
            if (successButton && !successButton.disabled) {
              successButton.click();
              log('content', 'Запись успешна для слота:', slot);
              chrome.runtime.sendMessage({
                action: 'updateWaitingListStatus',
                slot: Object.assign({}, slot, { status: 'success' }),
              });
            } else {
              log(
                'content',
                'Кнопка подтверждения не найдена или недоступна для слота:',
                slot
              );
              chrome.runtime.sendMessage({
                action: 'updateWaitingListStatus',
                slot: Object.assign({}, slot, { status: 'failed' }),
              });
            }
          }, 500);
        } else {
          log('content', 'Не найдена строка для записи для слота:', slot);
          chrome.runtime.sendMessage({
            action: 'updateWaitingListStatus',
            slot: Object.assign({}, slot, { status: 'failed' }),
          });
        }
      } else {
        var timeLeft = targetBookingTime - now;
        log(
          'content',
          'До открытия записи для слота "' +
            slot.name +
            '" осталось ' +
            timeLeft +
            ' мс. Проверяем через 1 сек.'
        );
        setTimeout(check, 1000);
      }
    }
    check();
  }

  window.addEventListener('load', function () {
    initAfterDelay();
  });

  function initAfterDelay() {
    log('content', 'Страница загружена. Инициализация...');
    getStorage({ currentWeekState: 'this' }, function (err, data) {
      log('content', 'Текущее состояние недели:', data.currentWeekState);
      if (data.currentWeekState === 'next') {
        var nextButton = document.querySelector('.fc-next-button');
        if (nextButton) nextButton.click();
        delay(2000, function () {
          var schedule = scanCurrentWeek();
          log('content', 'Итог сканирования расписания:', schedule);
          chrome.runtime.sendMessage({
            action: 'updateSchedule',
            schedule: schedule,
          });
          schedule
            .filter(function (ev) {
              return ev.status === 'success';
            })
            .forEach(function (ev) {
              chrome.runtime.sendMessage({
                action: 'addToWaitingList',
                slot: ev,
              });
            });
        });
      } else {
        var schedule = scanCurrentWeek();
        log('content', 'Итог сканирования расписания:', schedule);
        chrome.runtime.sendMessage({
          action: 'updateSchedule',
          schedule: schedule,
        });
        schedule
          .filter(function (ev) {
            return ev.status === 'success';
          })
          .forEach(function (ev) {
            chrome.runtime.sendMessage({
              action: 'addToWaitingList',
              slot: ev,
            });
          });
      }
    });
  }

  document.addEventListener('click', function (event) {
    var btn = event.target.closest(
      '.fc-prev-button, .fc-next-button, .fc-today-button'
    );
    if (btn) {
      log(
        'content',
        'Кнопка смены недели нажата, запускаем сканирование расписания.'
      );
      delay(1500, function () {
        var schedule = scanCurrentWeek();
        log(
          'content',
          'Сканирование после смены недели завершено. Расписание:',
          schedule
        );
        chrome.runtime.sendMessage(
          { action: 'updateSchedule', schedule: schedule },
          function (response) {
            log(
              'content',
              'Ответ updateSchedule после смены недели:',
              response
            );
          }
        );
        schedule
          .filter(function (ev) {
            return ev.status === 'success';
          })
          .forEach(function (ev) {
            chrome.runtime.sendMessage(
              { action: 'addToWaitingList', slot: ev },
              function (response) {
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

  chrome.runtime.onMessage.addListener(function (
    message,
    sender,
    sendResponse
  ) {
    log('content', 'Получено сообщение:', message);
    if (message.action === 'navigateWeek') {
      navigateToWeek(message.week);
      sendResponse({ success: true });
    } else if (message.action === 'scheduleBooking') {
      scheduleBooking(message.slot);
      sendResponse({ success: true });
    }
    return true;
  });
})();
