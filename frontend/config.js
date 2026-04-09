const API_BASE = (
  window.APP_CONFIG &&
  window.APP_CONFIG.API_BASE_URL &&
  !window.APP_CONFIG.API_BASE_URL.includes("replace-with-your-render-url")
)
  ? window.APP_CONFIG.API_BASE_URL.replace(/\/$/, '')
  : "https://student-management-system-5s3e.onrender.com";
