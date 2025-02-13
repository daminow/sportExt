// utils.js

export const getCurrentDateTime = () => new Date().toLocaleTimeString();

/**
 * Асинхронное получение данных из chrome.storage.local.
 * @param {string|string[]} keys
 * @returns {Promise<any>}
 */
export const getStorage = (keys) =>
  new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (data) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(data);
      }
    });
  });

/**
 * Асинхронная запись данных в chrome.storage.local.
 * @param {object} data
 * @returns {Promise<void>}
 */
export const setStorage = (data) =>
  new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });

/**
 * Универсальное логирование с указанием модуля.
 * @param {string} module
 * @param {string} message
 * @param  {...any} args
 */
export const log = (module, message, ...args) =>
  console.log(`[${getCurrentDateTime()}] [${module}] ${message}`, ...args);

// Константы для «магических чисел»
export const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;
export const HALF_DAY_IN_MS = 12 * 60 * 60 * 1000;
