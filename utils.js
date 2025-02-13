(function (global) {
  // Возвращает текущее время в виде строки
  function getCurrentDateTime() {
    return new Date().toLocaleTimeString();
  }

  // Асинхронное получение данных из chrome.storage.local (через callback)
  function getStorage(keys, callback) {
    chrome.storage.local.get(keys, function (data) {
      if (chrome.runtime.lastError) {
        callback(new Error(chrome.runtime.lastError.message));
      } else {
        callback(null, data);
      }
    });
  }

  // Асинхронная запись данных в chrome.storage.local (через callback)
  function setStorage(data, callback) {
    chrome.storage.local.set(data, function () {
      if (chrome.runtime.lastError) {
        callback(new Error(chrome.runtime.lastError.message));
      } else {
        callback(null);
      }
    });
  }

  // Универсальное логирование с указанием модуля
  function log(module, message) {
    var args = Array.prototype.slice.call(arguments, 2);
    // Используем spread-оператор, чтобы выводить аргументы по отдельности
    console.log(
      '[' + getCurrentDateTime() + '] [' + module + '] ' + message,
      ...args
    );
  }

  // Константы (магические числа)
  var WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;
  var HALF_DAY_IN_MS = 12 * 60 * 60 * 1000;

  // Экспортируем функции и константы в глобальный объект MyUtils
  global.MyUtils = {
    getCurrentDateTime: getCurrentDateTime,
    getStorage: getStorage,
    setStorage: setStorage,
    log: log,
    WEEK_IN_MS: WEEK_IN_MS,
    HALF_DAY_IN_MS: HALF_DAY_IN_MS,
  };
})(this);
