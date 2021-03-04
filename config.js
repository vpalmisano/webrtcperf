module.exports = {
    URL: process.env.URL,
    URL_QUERY: process.env.URL_QUERY,
    VIDEO_PATH: process.env.VIDEO_PATH,
    VIDEO_WIDTH: parseInt(process.env.VIDEO_WIDTH || 1280),
    VIDEO_HEIGHT: parseInt(process.env.VIDEO_HEIGHT || 720),
    VIDEO_FRAMERATE: parseInt(process.env.VIDEO_FRAMERATE || 25),
    //
    WINDOW_WIDTH: parseInt(process.env.WINDOW_WIDTH || 1920),
    WINDOW_HEIGHT: parseInt(process.env.WINDOW_HEIGHT || 1080),
    //
    SESSIONS: parseInt(process.env.SESSIONS || 1),
    TABS_PER_SESSION: parseInt(process.env.TABS_PER_SESSION || 1),
    SPAWN_PERIOD: parseInt(process.env.SPAWN_PERIOD || 1000),
    ENABLE_PAGE_LOG: process.env.ENABLE_PAGE_LOG === 'true',
    SHOW_STATS: process.env.SHOW_STATS !== 'false',
    LOG_PATH: process.env.LOG_PATH,
    LOG_INTERVAL: parseInt(process.env.LOG_INTERVAL || 1),
    //
    SCRIPT_PATH: process.env.SCRIPT_PATH,
}