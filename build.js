const fs = require('fs');
const path = require('path');
const terser = require('terser');

const jsSourceDir = path.join(__dirname, 'public', 'js');
const jsDistDir = path.join(__dirname, 'public', 'dist');

// Создаем папку dist, если ее нет
if (!fs.existsSync(jsDistDir)) {
  fs.mkdirSync(jsDistDir, { recursive: true });
}

fs.readdir(jsSourceDir, (err, files) => {
  if (err) {
    console.error("Не удалось прочитать папку со скриптами:", err);
    return;
  }

  files.forEach(file => {
    if (path.extname(file) === '.js') {
      const sourcePath = path.join(jsSourceDir, file);
      const distPath = path.join(jsDistDir, file);

      fs.readFile(sourcePath, 'utf8', (err, code) => {
        if (err) {
          console.error(`Ошибка чтения файла ${file}:`, err);
          return;
        }

        terser.minify(code).then(result => {
          if (result.error) {
            console.error(`Ошибка сжатия файла ${file}:`, result.error);
          } else {
            fs.writeFile(distPath, result.code, (err) => {
              if (err) {
                console.error(`Ошибка записи сжатого файла ${file}:`, err);
              } else {
                console.log(`✅ Скрипт успешно сжат: ${file}`);
              }
            });
          }
        });
      });
    }
  });
});