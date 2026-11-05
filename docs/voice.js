// The mic button. It uses the speech recognition built into the browser, which Apple
// supports unevenly in Home Screen apps, so every failure ends in a clear message.
import { load, save, showNotice } from './api.js';

const LANGUAGE_KEY = 'voiceLanguage';
const LANGUAGES = { en: { code: 'en-US', label: 'EN' }, he: { code: 'he-IL', label: 'עב' } };

const $ = (id) => document.getElementById(id);

function errorMessage(error) {
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

  function start() {
    if (!Recognition) {
      showNotice('Speech isn\'t available in this app on your phone.');
      return;
    }
    const before = input.value.trim();
    recognition = new Recognition();
    recognition.lang = LANGUAGES[language].code;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const heard = [...event.results].map((result) => result[0].transcript).join('');
      input.value = (before ? before + ' ' : '') + heard;
      onTextChange();
    };
    recognition.onerror = (event) => {
      if (event.error !== 'aborted') showNotice(errorMessage(event.error));
    };
    recognition.onend = () => {
      recognition = null;
      setListening(false);
    };
    try {
      recognition.start();
      setListening(true);
    } catch (error) {
      recognition = null;
      showNotice(errorMessage(error.message));
    }
  }

  // Apple needs speech to start directly from a tap, so this stays on the click itself.
  mic.addEventListener('click', () => {
    if (recognition) recognition.stop();
    else start();
  });
  languageButton.addEventListener('click', () => {
    language = language === 'en' ? 'he' : 'en';
    save(LANGUAGE_KEY, language);
    showLanguage();
  });
  showLanguage();
}
