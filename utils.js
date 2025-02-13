// utils.js
export const getCurrentDateTime = () => new Date().toLocaleTimeString();

export const getStorage = (keys) =>
  new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (data) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(data);
    });
  });

export const setStorage = (data) =>
  new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });

// Универсальное логирование с указанием модуля
export const log = (module, message, ...args) =>
  console.log(`[${getCurrentDateTime()}] [${module}] ${message}`, ...args);
