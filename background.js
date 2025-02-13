// Если доступна функция importScripts (например, в сервис-воркере), загружаем utils.js
if (typeof importScripts === 'function') {
  importScripts('utils.js');
}

(function () {
  // Если MyUtils не определён, можно попробовать вывести сообщение об ошибке
  if (!window.MyUtils) {
    console.error('MyUtils не определён! Убедитесь, что utils.js загружен.');
    return;
  }

  var log = MyUtils.log,
    getStorage = MyUtils.getStorage,
    setStorage = MyUtils.setStorage,
    WEEK_IN_MS = MyUtils.WEEK_IN_MS,
    HALF_DAY_IN_MS = MyUtils.HALF_DAY_IN_MS;

  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    log(
      'background',
      'onUpdated: TabID=' + tabId + ', changeInfo=',
      changeInfo
    );
    if (
      changeInfo.status === 'complete' &&
      tab &&
      tab.url &&
      tab.url.indexOf('https://sport.innopolis.university/profile/') === 0
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

  function validateMessage(message) {
    return message && typeof message.action === 'string';
  }

  chrome.runtime.onMessage.addListener(function (
    message,
    sender,
    sendResponse
  ) {
    try {
      if (!validateMessage(message)) {
        throw new Error('Неверное сообщение');
      }
      if (message.action === 'updateSchedule') {
        log('background', 'updateSchedule: Обновляем расписание в хранилище.');
        setStorage(
          {
            schedule: message.schedule,
            lastUpdated: Date.now(),
            scanningComplete: true,
          },
          function (err) {
            if (err) {
              sendResponse({ error: err.message });
            } else {
              log(
                'background',
                'updateSchedule: Расписание обновлено:',
                message.schedule
              );
              sendResponse({ success: true });
            }
          }
        );
        return true;
      }
      if (message.action === 'updateWaitingList') {
        log(
          'background',
          'updateWaitingList: Получен запрос обновления waiting list.'
        );
        sendResponse({ success: true });
        return true;
      }
      if (message.action === 'openPopup') {
        log('background', 'openPopup: Получена команда для открытия popup.');
        chrome.action.openPopup();
        sendResponse({ success: true });
        return true;
      }
      if (message.action === 'updateWaitingListStatus') {
        log(
          'background',
          'updateWaitingListStatus: Начало обновления статуса для слота:',
          message.slot
        );
        getStorage('waitingList', function (err, data) {
          if (err) {
            sendResponse({ error: err.message });
            return;
          }
          var waitingLists = (data && data.waitingList) || {};
          var identifier =
            message.slot.name + message.slot.date + message.slot.start;
          for (var week in waitingLists) {
            waitingLists[week] = waitingLists[week].map(function (slot) {
              if (slot.name + slot.date + slot.start === identifier) {
                log(
                  'background',
                  'updateWaitingListStatus: Обновление статуса для слота ' +
                    identifier +
                    ' на ' +
                    message.slot.status
                );
                return Object.assign({}, slot, { status: message.slot.status });
              }
              return slot;
            });
          }
          setStorage({ waitingList: waitingLists }, function (err) {
            if (err) {
              sendResponse({ error: err.message });
            } else {
              log(
                'background',
                'updateWaitingListStatus: Статус обновлён для слота:',
                message.slot,
                'Новый waiting list:',
                waitingLists
              );
              sendResponse({ success: true });
            }
          });
        });
        return true;
      }
      // Если действие требует обращения к вкладке
      chrome.tabs.query(
        { url: 'https://sport.innopolis.university/profile/*' },
        function (tabs) {
          log('background', 'onMessage: Ищем вкладку с нужным URL...');
          if (!tabs || tabs.length === 0) {
            log('background', 'onMessage: Нет вкладок с нужным URL.');
            sendResponse({ error: 'Нет вкладок с нужным URL' });
            return;
          }
          var tab = tabs[0];
          log('background', 'onMessage: Найдена вкладка, URL: ' + tab.url);
          if (message.action === 'scanSchedule') {
            log(
              'background',
              'scanSchedule: Запрос сканирования для недели:',
              message.week
            );
            chrome.tabs.sendMessage(
              tab.id,
              { action: 'scanSchedule', week: message.week },
              function (response) {
                log('background', 'scanSchedule: Ответ получен:', response);
                sendResponse({ success: true });
              }
            );
          } else if (message.action === 'navigateWeek') {
            log(
              'background',
              'navigateWeek: Запрос навигации для недели:',
              message.week
            );
            chrome.tabs.sendMessage(
              tab.id,
              { action: 'navigateWeek', week: message.week },
              function (response) {
                log('background', 'navigateWeek: Ответ получен:', response);
                sendResponse({ success: true });
              }
            );
          } else if (message.action === 'bookSport') {
            log(
              'background',
              'bookSport: Запрос бронирования для слота:',
              message.slot
            );
            chrome.windows.getCurrent(function (win) {
              if (!win) {
                log('background', 'bookSport: Нет активного окна.');
                sendResponse({ error: 'Нет активного окна' });
                return;
              }
              chrome.scripting.executeScript(
                {
                  target: { tabId: tab.id },
                  func: bookSport,
                  args: [message.slot],
                },
                function (results) {
                  if (chrome.runtime.lastError) {
                    log(
                      'background',
                      'bookSport: Ошибка:',
                      chrome.runtime.lastError.message
                    );
                    sendResponse({ error: chrome.runtime.lastError.message });
                  } else {
                    log(
                      'background',
                      'bookSport: Бронирование выполнено успешно.'
                    );
                    sendResponse({ success: true });
                  }
                }
              );
            });
          } else if (message.action === 'addToWaitingList') {
            log(
              'background',
              'addToWaitingList: Запрос добавления в waiting list для слота:',
              message.slot
            );
            addToWaitingList(message.slot, function () {
              sendResponse({ success: true });
            });
          } else if (message.action === 'scheduleBooking') {
            log(
              'background',
              'scheduleBooking: Запрос планирования бронирования для слота:',
              message.slot
            );
            chrome.tabs.sendMessage(
              tab.id,
              { action: 'scheduleBooking', slot: message.slot },
              function (response) {
                log('background', 'scheduleBooking: Ответ получен:', response);
                sendResponse({ success: true });
              }
            );
          } else {
            log(
              'background',
              'onMessage: Неизвестное действие:',
              message.action
            );
            sendResponse({
              warning: 'Неизвестное действие: ' + message.action,
            });
          }
        }
      );
    } catch (error) {
      log('background', 'onMessage: Ошибка:', error);
      sendResponse({ error: error.message });
    }
    return true;
  });

  // Функция бронирования (выполняется в контексте страницы)
  function bookSport(slot) {
    MyUtils.log('bookSport', 'Начало попытки бронирования для слота:', slot);
    var rows = Array.prototype.slice.call(
      document.querySelectorAll('.swiper-slide-active .fc-list-table tr')
    );
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var titleElem = row.querySelector('.fc-list-item-title a');
      var timeElem = row.querySelector('.fc-list-item-time');
      if (
        titleElem &&
        timeElem &&
        titleElem.textContent.indexOf(slot.name) !== -1
      ) {
        MyUtils.log('bookSport', 'Найден слот для бронирования:', slot);
        var checkInButton = document.querySelector(
          '.modal-content .btn-success'
        );
        if (checkInButton) {
          MyUtils.log(
            'bookSport',
            'Кнопка бронирования найдена, выполняем клик.'
          );
          checkInButton.click();
        } else {
          MyUtils.log('bookSport', 'Кнопка бронирования не найдена!');
        }
        return;
      }
    }
    MyUtils.log('bookSport', 'Слот для бронирования не найден:', slot);
  }

  // Функция добавления слота в waiting list
  function addToWaitingList(slot, callback) {
    MyUtils.log(
      'addToWaitingList',
      'Начало добавления слота в waiting list:',
      slot
    );
    if (slot.status !== 'success') {
      slot.status = 'waiting';
    }
    getStorage({ currentWeekState: 'this' }, function (err, data) {
      if (!slot.week) {
        slot.week = data ? data.currentWeekState : 'this';
      }
      processAddToWaitingList(slot, callback);
    });
  }

  function processAddToWaitingList(slot, callback) {
    getStorage('waitingList', function (err, data) {
      var waitingListObj = (data && data.waitingList) || {};
      MyUtils.log(
        'addToWaitingList',
        'Текущее состояние waiting list из хранилища:',
        waitingListObj
      );
      var weekList = waitingListObj[slot.week] || [];
      var identifier = slot.name + slot.date + slot.start;
      var exists = weekList.some(function (item) {
        return item.name + item.date + item.start === identifier;
      });
      if (!exists) {
        weekList.unshift(slot);
        waitingListObj[slot.week] = weekList;
        setStorage({ waitingList: waitingListObj }, function (err) {
          MyUtils.log(
            'addToWaitingList',
            'Элемент успешно добавлен в waiting list для недели "' +
              slot.week +
              '". Обновлённое состояние waiting list:',
            waitingListObj
          );
          showNotification(
            slot.status === 'success'
              ? 'Запись подтверждена'
              : 'Добавлено в лист ожидания',
            slot.name + ' (' + slot.day + ')',
            'info'
          );
          callback && callback();
        });
      } else {
        MyUtils.log(
          'addToWaitingList',
          'Элемент уже присутствует в waiting list, добавление пропущено. Текущий слот:',
          slot
        );
        showNotification(
          'Уже в листе ожидания',
          slot.name + ' (' + slot.day + ')',
          'info'
        );
        callback && callback();
      }
    });
  }

  function showNotification(title, message, type) {
    MyUtils.log(
      'background',
      'showNotification: ' + title + ' - ' + message + ' (тип: ' + type + ')'
    );
    chrome.notifications.create('', {
      type: 'basic',
      iconUrl: 'icon.png',
      title: title,
      message: message,
      priority: type === 'error' ? 2 : 0,
    });
  }

  chrome.alarms.onAlarm.addListener(function () {
    MyUtils.log('background', 'Alarm сработал. Начало проверки waiting list.');
    getStorage('waitingList', function (err, data) {
      var waitingLists = (data && data.waitingList) || {};
      var now = new Date();
      var nextCheckTime = Infinity;
      for (var week in waitingLists) {
        var list = waitingLists[week];
        if (list && list.length > 0) {
          var slot = list[0];
          MyUtils.log(
            'background',
            'Alarm: Обрабатываем слот для недели "' + week + '":',
            slot
          );
          if (slot.status === 'success') {
            MyUtils.log(
              'background',
              'Alarm: Слот (' +
                slot.name +
                ' ' +
                slot.date +
                ' ' +
                slot.start +
                ') уже успешен, пропускаем.'
            );
            list.shift();
            waitingLists[week] = list;
            continue;
          }
          var bookingOffset;
          if (slot.color && slot.color.indexOf('0, 123, 255') !== -1) {
            bookingOffset = WEEK_IN_MS;
          } else if (
            slot.color &&
            (slot.color.indexOf('red') !== -1 ||
              slot.color.indexOf('rgb(255, 0, 0)') !== -1)
          ) {
            bookingOffset = WEEK_IN_MS + HALF_DAY_IN_MS;
          } else {
            bookingOffset = WEEK_IN_MS;
          }
          var eventStart = new Date(slot.date + 'T' + slot.start + ':00');
          var targetBookingTime = new Date(
            eventStart.getTime() - bookingOffset
          );
          var timeLeft = targetBookingTime - now;
          MyUtils.log(
            'background',
            'Alarm: Для слота (' +
              slot.name +
              ') осталось ' +
              timeLeft +
              ' мс до открытия записи.'
          );
          if (timeLeft <= 0) {
            MyUtils.log(
              'background',
              'Alarm: Время открытия записи наступило для слота:',
              slot
            );
            chrome.tabs.query(
              { url: 'https://sport.innopolis.university/profile/*' },
              function (tabs) {
                if (tabs.length > 0) {
                  MyUtils.log(
                    'background',
                    'Alarm: Отправляем сообщение на бронирование слота через вкладку ' +
                      tabs[0].id +
                      '.'
                  );
                  chrome.tabs.sendMessage(
                    tabs[0].id,
                    { action: 'scheduleBooking', slot: slot },
                    function (response) {
                      MyUtils.log(
                        'background',
                        'Alarm: scheduleBooking выполнено, ответ:',
                        response
                      );
                    }
                  );
                } else {
                  MyUtils.log(
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
      MyUtils.log(
        'background',
        'Alarm: Итоговый waiting list после проверки:',
        waitingLists
      );
      setStorage({ waitingList: waitingLists }, function () {
        MyUtils.log('background', 'Alarm: waiting list обновлён в хранилище.');
      });
    });
  });

  chrome.alarms.create('checkWaitingList', { delayInMinutes: 1 });
  MyUtils.log(
    'background',
    'Начальный alarm "checkWaitingList" создан с задержкой 1 минута.'
  );
})();
