// Данные из Google Cloud Console (см. README.md, раздел «Настройка Google»).
// Client ID и API key не секретны — это публичные идентификаторы OAuth-клиента,
// их можно спокойно хранить в этом файле и даже коммитить в репозиторий.
export const GOOGLE_CONFIG = {
  clientId: 'ВСТАВЬТЕ_СЮДА_CLIENT_ID.apps.googleusercontent.com',
  apiKey: 'ВСТАВЬТЕ_СЮДА_API_KEY',
  appId: 'ВСТАВЬТЕ_СЮДА_PROJECT_NUMBER',
  // Пока проект в Google Cloud не прошёл верификацию, войти могут только
  // "Test users", добавленные вручную в OAuth consent screen. На этот адрес
  // приходят запросы на доступ из кнопки «Запросить доступ» в приложении.
  adminEmail: 'dimetriusk@gmail.com',
};
