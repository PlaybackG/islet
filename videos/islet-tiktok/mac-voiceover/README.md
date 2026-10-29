# Озвучка на маке (ElevenLabs · Liam · eleven_v3)

В папке два файла: `tts.mjs` и `vo.txt`. Ключа здесь нет и не будет.

## 1. Node (если нет)
```
brew install node
```
или скачай LTS с https://nodejs.org

## 2. Ключ
Скопируй ключ ElevenLabs (https://elevenlabs.io/app/settings/api-keys) в буфер, затем:
```
mkdir -p ~/.secrets && pbpaste > ~/.secrets/elevenlabs.key
```

## 3. Генерация
```
cd путь/к/mac-voiceover
node tts.mjs vo.mp3 vo.txt
```
Появятся `vo.mp3` и `vo.words.json` (тайминги слов — по ним текст в видео встаёт ровно под голос).

Не нравится дубль — запусти ещё раз, v3 каждый раз читает чуть по-другому. Текст правится в `vo.txt`.

## 4. Обратно на Windows
Закинь `vo.mp3` и `vo.words.json` в `videos/islet-tiktok/assets/audio/`.

### Без терминала
На сайте: Text to Speech → голос Liam → модель Eleven v3 → вставить текст из `vo.txt` → скачать mp3.
Пришли только `vo.mp3` — тайминги слов тогда сниму сам, но с консолью точнее.
