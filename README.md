<p align="center"><img src="docs/banner.png" alt="Islet: динамический остров для Windows"></p>

<p align="center">
  <a href="https://github.com/PlaybackG/islet/releases/latest/download/IsletSetup.exe"><img src="https://img.shields.io/badge/Скачать_для_Windows-9aa6ff?style=for-the-badge&logoColor=white" alt="Скачать для Windows"></a>
  <a href="https://playbackg.github.io/islet/"><img src="https://img.shields.io/badge/Сайт-151821?style=for-the-badge" alt="Сайт"></a>
  <a href="https://github.com/PlaybackG/islet/releases/latest"><img src="https://img.shields.io/badge/версия-0.1.2-151821?style=for-the-badge" alt="Версия"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/лицензия-MIT-151821?style=for-the-badge" alt="Лицензия MIT"></a>
</p>

Маленькая капсула наверху экрана. Наведи мышку, и в ней музыка, файлы, уведомления и чат с ИИ. Убрал мышку, и она снова не мешает. Для Windows 10 и 11, бесплатно и с открытым кодом.

<p align="center"><img src="docs/demo.gif" alt="Капсула раскрывается в панели: главная, буфер, уведомления, чат" width="720"></p>

## Что умеет

| | |
|---|---|
| **Музыка.** Обложка, управление и волна под бит прямо в капсуле. | **Буфер.** Всё, что ты копировал, с поиском и закреплением. |
| <img src="site/assets/home.png" alt="Главная вкладка"> | <img src="site/assets/clips.png" alt="Буфер обмена"> |
| **Уведомления.** Сообщения с иконками приложений, клик открывает приложение. | **Чат с ИИ.** Спросить что-то, не открывая браузер. |
| <img src="site/assets/notifs.png" alt="Уведомления"> | <img src="site/assets/chat.png" alt="Чат с ИИ"> |
| **Полка.** Перетащи файлы на остров и забери, когда понадобятся. | **Текст.** Раскладка, регистр, транслит, JSON, Base64 и ИИ-правка. |
| <img src="site/assets/shelf.png" alt="Полка"> | <img src="site/assets/text.png" alt="Текст"> |

А ещё заметки с таймерами, погода, управление системой, загрузки с настоящим процентом и глазки: в покое они моргают, следят за курсором и меняют стиль.

## Установка

1. Скачай [IsletSetup.exe](https://github.com/PlaybackG/islet/releases/latest/download/IsletSetup.exe), около 140 МБ.
2. Запусти. Windows может предупредить о неизвестном издателе: нажми «Подробнее», потом «Выполнить в любом случае».
3. Остров появится сверху экрана и будет запускаться вместе с Windows.

## Запуск из исходников

Нужен [Node.js](https://nodejs.org) 20 или новее.

```bash
cd islet
npm install
npx electron .
```

## macOS

Нужны Node.js 20+ и Xcode Command Line Tools (macOS 13 или новее).

```bash
cd islet
npm install
npm start          # запуск из исходников
npm run dist:mac   # .dmg в islet/dist
```

На MacBook с чёлкой капсула обнимает вырез: глазки слева, погода и заряд справа, часы остаются в строке меню. Приложение подписано без сертификата, поэтому при первом запуске macOS его заблокирует: Системные настройки → Конфиденциальность и безопасность → «Всё равно открыть».

Разрешения спрашиваются по мере надобности: запись экрана (скриншоты, OCR, запись), Универсальный доступ (вставка из буфера), Полный доступ к диску (чужие уведомления на острове). Волна под музыку на Mac идёт в ровном ритме, а не по настоящему звуку.

## Что где

- `islet/` — приложение (Electron). `main.js` — основной процесс, `ui/` — интерфейс, `native.js` и `helper.ps1` — WinAPI, медиа, громкость, OCR; `native.mac.js` и `mac/helper.swift` — то же для macOS.
- `site/` — лендинг на GitHub Pages.
- `videos/islet-tiktok/` — ролик на HyperFrames (аудио в репозиторий не входит).

## Ключи

Ключи для чата с ИИ и распознавания речи вводятся в настройках приложения и хранятся только у тебя в `%APPDATA%\Islet`. В репозитории ключей нет.

## Благодарность

Скоро

## Лицензия

[MIT](LICENSE)
