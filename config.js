// Данные из Google Cloud Console (см. README.md, раздел «Настройка Google»).
// Client ID и API key не секретны — это публичные идентификаторы OAuth-клиента,
// их можно спокойно хранить в этом файле и даже коммитить в репозиторий.
export const GOOGLE_CONFIG = {
  clientId: '155596971346-0hr8sh5p4udnbnst7ii3in5iap23stl8.apps.googleusercontent.com',
  apiKey: 'AIzaSyD_9h6KjJrbQfvAvAJ59B45QizMxy6HHqU',
  // ВАЖНО: appId для Google Picker — это числовой "Project number" (например 155596971346),
  // а НЕ строковый "Project ID". Похоже, что сейчас здесь стоит Project ID — проверьте
  // на главной странице Google Cloud Console и, если нужно, замените на число.
  appId: 'vacation-sync-1',
  // Пока проект в Google Cloud не прошёл верификацию, войти могут только
  // "Test users", добавленные вручную в OAuth consent screen. На этот адрес
  // приходят запросы на доступ из кнопки «Запросить доступ» в приложении.
  adminEmail: 'dimetriusk@gmail.com',
};
