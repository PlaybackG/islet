// Простое хранилище: JSON-файлы в папке данных, запись с задержкой и атомарной заменой.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir, name, defaults) {
    this.file = path.join(dir, name + '.json');
    this.defaults = defaults;
    this.timer = null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = Array.isArray(defaults) ? raw : { ...structuredClone(defaults), ...raw };
    } catch {
      this.data = structuredClone(defaults);
    }
  }

  save(delay = 400) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = Store;
