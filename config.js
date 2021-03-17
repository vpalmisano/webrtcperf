module.exports = {
    URL: process.env.URL,
    URL_QUERY: process.env.URL_QUERY,
    VIDEO_PATH: process.env.VIDEO_PATH,
    VIDEO_WIDTH: parseInt(process.env.VIDEO_WIDTH || 1280),
    VIDEO_HEIGHT: parseInt(process.env.VIDEO_HEIGHT || 720),
    VIDEO_FRAMERATE: parseInt(process.env.VIDEO_FRAMERATE || 25),
    //
    CHROMIUM_PATH: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser-unstable',
    WINDOW_WIDTH: parseInt(process.env.WINDOW_WIDTH || 1920),
    WINDOW_HEIGHT: parseInt(process.env.WINDOW_HEIGHT || 1080),
    USE_NULL_VIDEO_DECODER: process.env.USE_NULL_VIDEO_DECODER === 'true',
    //
    SESSIONS: parseInt(process.env.SESSIONS || 1),
    TABS_PER_SESSION: parseInt(process.env.TABS_PER_SESSION || 1),
    SPAWN_PERIOD: parseInt(process.env.SPAWN_PERIOD || 1000),
    ENABLE_PAGE_LOG: process.env.ENABLE_PAGE_LOG === 'true',
    SHOW_STATS: process.env.SHOW_STATS !== 'false',
    STATS_PATH: process.env.STATS_PATH,
    STATS_INTERVAL: parseInt(process.env.STATS_INTERVAL || 2),
    ENABLE_RTC_STATS: process.env.ENABLE_RTC_STATS !== 'false',
    RTC_STATS_TIMEOUT: parseInt(process.env.RTC_STATS_TIMEOUT || 60),
    //
    SCRIPT_PATH: process.env.SCRIPT_PATH,
    PRELOAD_SCRIPT_PATH: process.env.PRELOAD_SCRIPT_PATH,
    GET_USER_MEDIA_OVERRIDES: JSON.parse(process.env.GET_USER_MEDIA_OVERRIDES || '[]'),
    RUN_DURATION: parseInt(process.env.RUN_DURATION || 0),
}
