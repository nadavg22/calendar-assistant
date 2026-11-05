// The mic button. It uses the speech recognition built into the browser, which Apple
// supports unevenly in Home Screen apps, so every failure ends in a clear message.
import { load, save, showNotice } from './api.js';

const LANGUAGE_KEY = 'voiceLanguage';
// Each language lists the codes to try, in order, because Apple's support varies.
const LANGUAGES = { en: { codes: ['en-US'], label: 'EN' }, he: { codes: ['he-IL', 'he', 'iw-IL'], label: 'עב' } };
const HEBREW_HELP = 'Hebrew speech needs Hebrew on your iPhone: Settings, General, Keyboard, Keyboards, Add New Keyboard, Hebrew. Dictation must be on too.';

const $ = (id) => document.getElementById(id);

function errorMessage(error, language) {
  if (error === 'language-not-supported') return language === 'he' ? HEBREW_HELP : 'This language isn\'t available for speech on your phone.';
  if (error === 'no-speech') return 'I didn\'t hear anything. Please try again.';
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    return 'Speech isn\'t allowed here. Check that Dictation and Siri are on in your iPhone settings, and that this app may use the microphone.';
  }
  if (error === 'network') return 'Speech recognition needs an internet connection.';
  return 'Speech didn\'t work (' + error + '). You can type instead.';
}

export function setupVoice(onTextChange) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $('mic');
  const languageButton = $('voice-language');
  const input = $('input');
  let language = load(LANGUAGE_KEY, 'en');
  let recognition = null;

  const showLanguage = () => { languageButton.textContent = LANGUAGES[language].label; };

  const setListening = (listening) => {
    mic.classList.toggle('listening', listening);
    mic.setAttribute('aria-pressed', String(listening));
    input.placeholder = listening ? 'Listening...' : 'Message';
  };

  function start(attempt = 0) {
    if (!Recognition) {
      showNotice('Speech isn\'t available in this app on your phone.');
      return;
    }
    const before = input.value.trim();
    const codes = LANGUAGES[language].codes;
    let heard = '';
    let failed = false;
    let retrying = false;

    recognition = new Recognition();
    recognition.lang = codes[attempt];
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      heard = [...event.results].map((result) => result[0].transcript).join('');
      input.value = (before ? before + ' ' : '') + heard;
      onTextChange();
    };
    recognition.onerror = (event) => {
      failed = true;
      if (event.error === 'aborted') return;
      if (event.error === 'language-not-supported' && attempt + 1 < codes.length) {
        retrying = true;
        return;
      }
      showNotice(errorMessage(event.error, language));
    };
    recognition.onend = () => {
      recognition = null;
      setListening(false);
      if (retrying) {
        start(attempt + 1);
      } else if (!heard && !failed) {
        showNotice(language === 'he' ? 'Nothing came through in Hebrew. ' + HEBREW_HELP : errorMessage('no-speech', language));
      }
    };
    try {
      recognition.start();
      setListening(true);
    } catch (error) {
      recognition = null;
      showNotice(errorMessage(error.message, language));
    }
  }

  // Apple needs speech to start directly from a tap, so this stays on the click itself.
  mic.addEventListener('click', () => {
    if (recognition) recognition.stop();
    else start(0);
  });
  languageButton.addEventListener('click', () => {
    language = language === 'en' ? 'he' : 'en';
    save(LANGUAGE_KEY, language);
    showLanguage();
  });
  showLanguage();
}
